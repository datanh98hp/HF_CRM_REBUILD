import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  CustomerImportBatchStatus,
  Prisma,
} from '../generated/prisma/client.js';
import { AuditService } from '../audit/audit.service.js';
import type { ActorContext } from '../common/actor-context.js';
import { PrismaService } from '../database/prisma.service.js';
import { ClamAvScannerService } from './clamav-scanner.service.js';
import { CustomerImportFileError, parseCustomerImportFile, type CustomerImportFileFormat, type CustomerImportRecord } from './customer-import-parser.js';
import { CustomerImportTempStorageService } from './customer-import-temp-storage.service.js';

const TERMINAL_STATUSES = new Set<CustomerImportBatchStatus>([
  CustomerImportBatchStatus.COMPLETED,
  CustomerImportBatchStatus.FAILED,
  CustomerImportBatchStatus.CANCELLED,
  CustomerImportBatchStatus.EXPIRED,
]);

function isFileFormat(value: unknown): value is CustomerImportFileFormat {
  return value === 'csv' || value === 'xlsx';
}

function safeErrorCode(error: unknown): string {
  if (error instanceof CustomerImportFileError) return error.code;
  if (error instanceof Error && error.name.startsWith('ClamAv')) {
    return 'SCANNER_UNAVAILABLE';
  }
  if (error instanceof AggregateError) return 'TEMP_FILE_DELETE_FAILED';
  return 'IMPORT_PROCESSING_FAILED';
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function dateKey(value: Date | null): string {
  return value?.toISOString().slice(0, 10) ?? '';
}

@Injectable()
export class CustomerImportWorkerService {
  private readonly logger = new Logger(CustomerImportWorkerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly scanner: ClamAvScannerService,
    private readonly storage: CustomerImportTempStorageService,
  ) {}

  async process(batchId: string, format: CustomerImportFileFormat): Promise<{ status: string }> {
    const batch = await this.prisma.customerImportBatch.findUnique({ where: { id: batchId } });
    if (!batch) throw new Error('Customer import batch does not exist');
    if (TERMINAL_STATUSES.has(batch.status)) return { status: batch.status };
    if (!isFileFormat(format) || !batch.tempFileKey || !batch.fileSha256) {
      await this.failBatch(batch, 'IMPORT_METADATA_INVALID', 0);
      return { status: CustomerImportBatchStatus.FAILED };
    }

    let promotionCommitted = batch.status === CustomerImportBatchStatus.COMMITTING;
    let failedInsertRows = 0;
    try {
      if (promotionCommitted) {
        await this.storage.remove(batch.tempFileKey);
      } else {
        await this.prisma.customerImportBatch.update({
          where: { id: batchId },
          data: { status: CustomerImportBatchStatus.SCANNING, errorCode: null },
        });

        await this.storage.processAndDelete(batch.tempFileKey, async (path) => {
          const scanResult = await this.scanner.scanFile(path);
          if (scanResult !== 'CLEAN') throw new CustomerImportFileError('FILE_INFECTED');

          await this.prisma.customerImportBatch.update({
            where: { id: batchId },
            data: { status: CustomerImportBatchStatus.PROCESSING },
          });

          const file = await readFile(path);
          const digest = createHash('sha256').update(file).digest('hex');
          if (digest !== batch.fileSha256) throw new CustomerImportFileError('FILE_CHANGED_AFTER_UPLOAD');
          const records = await parseCustomerImportFile(file, format);
          await this.promoteBatch(batch, records, (eligibleRows) => {
            failedInsertRows = eligibleRows;
          });
          promotionCommitted = true;
          return records.length;
        });
      }

      await this.finalizeBatch(batch);
      return { status: CustomerImportBatchStatus.COMPLETED };
    } catch (error) {
      const errorCode = safeErrorCode(error);
      this.logger.error(
        `Customer import batch failed (batchId=${batchId}, code=${errorCode}, cause=${error instanceof Error ? error.name : 'UnknownError'})`,
      );
      if (promotionCommitted) throw error;
      const current = await this.prisma.customerImportBatch.findUnique({ where: { id: batchId } });
      if (current?.status === CustomerImportBatchStatus.COMMITTING) {
        await this.storage.remove(current.tempFileKey ?? batch.tempFileKey);
        await this.finalizeBatch(batch);
        return { status: CustomerImportBatchStatus.COMPLETED };
      }
      await this.failBatch(batch, errorCode, failedInsertRows);
      return { status: CustomerImportBatchStatus.FAILED };
    }
  }

  private async promoteBatch(
    batch: { id: string; branchId: string; createdById: string },
    records: CustomerImportRecord[],
    setEligibleRows: (count: number) => void,
  ): Promise<void> {
    let importedRows = 0;
    let duplicateRows = 0;

    await this.prisma.$transaction(async (tx) => {
      const transition = await tx.customerImportBatch.updateMany({
        where: { id: batch.id, status: CustomerImportBatchStatus.PROCESSING },
        data: { status: CustomerImportBatchStatus.COMMITTING },
      });
      if (transition.count !== 1) throw new Error('Customer import batch is not processable');

      const existing = await this.findExistingDuplicates(tx, records);
      const seenPhones = new Set<string>();
      const seenEmails = new Set<string>();
      const seenNameBirthdays = new Set<string>();
      const customers: CustomerImportRecord[] = [];

      for (const record of records) {
        const birthKey = dateKey(record.dateOfBirth);
        const nameBirthdayKey = birthKey ? `${record.normalizedName}\u0000${birthKey}` : '';
        const duplicate =
          existing.phones.has(record.phoneNormalized) ||
          (record.emailNormalized !== null && existing.emails.has(record.emailNormalized)) ||
          (nameBirthdayKey !== '' && existing.nameBirthdays.has(nameBirthdayKey)) ||
          seenPhones.has(record.phoneNormalized) ||
          (record.emailNormalized !== null && seenEmails.has(record.emailNormalized)) ||
          (nameBirthdayKey !== '' && seenNameBirthdays.has(nameBirthdayKey));

        if (duplicate) duplicateRows += 1;
        else customers.push(record);
        seenPhones.add(record.phoneNormalized);
        if (record.emailNormalized) seenEmails.add(record.emailNormalized);
        if (nameBirthdayKey) seenNameBirthdays.add(nameBirthdayKey);
      }

      importedRows = customers.length;
      setEligibleRows(importedRows);
      if (customers.length) {
        await tx.customer.createMany({
          data: customers.map((customer) => ({
            fullName: customer.fullName,
            normalizedName: customer.normalizedName,
            phone: customer.phone,
            phoneNormalized: customer.phoneNormalized,
            email: customer.email,
            emailNormalized: customer.emailNormalized,
            dateOfBirth: customer.dateOfBirth,
            provenance: 'IMPORT',
            branchId: batch.branchId,
            createdById: batch.createdById,
          })),
        });
      }

      await tx.customerImportRow.deleteMany({ where: { batchId: batch.id } });
      await tx.customerImportBatch.update({
        where: { id: batch.id },
        data: {
          status: CustomerImportBatchStatus.COMMITTING,
          importedRows,
          duplicateRows,
          failedInsertRows: 0,
          errorCode: null,
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 60_000 });
  }

  private async finalizeBatch(batch: { id: string; branchId: string; createdById: string }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const current = await tx.customerImportBatch.findUnique({ where: { id: batch.id } });
      if (!current || TERMINAL_STATUSES.has(current.status)) return;
      if (current.status !== CustomerImportBatchStatus.COMMITTING) {
        throw new Error('Customer import batch is not ready to finalize');
      }

      const transition = await tx.customerImportBatch.updateMany({
        where: { id: batch.id, status: CustomerImportBatchStatus.COMMITTING },
        data: {
          status: CustomerImportBatchStatus.COMPLETED,
          totalRows: 0,
          validRows: 0,
          invalidRows: 0,
          skippedRows: 0,
          tempFileKey: null,
          fileSha256: null,
          columnMapping: {},
          selectedSheet: null,
          errorCode: null,
          completedAt: new Date(),
        },
      });
      if (transition.count !== 1) return;

      await tx.customerImportRow.deleteMany({ where: { batchId: batch.id } });
      await this.audit.write(tx, {
        actor: this.actor(batch.createdById),
        action: 'customer.import.completed',
        targetType: 'customer-import-batch',
        targetId: batch.id,
        branchId: batch.branchId,
        afterState: {
          importedRows: current.importedRows,
          duplicateRows: current.duplicateRows,
          failedInsertRows: current.failedInsertRows,
        },
      });
    });
  }

  private async findExistingDuplicates(
    tx: Prisma.TransactionClient,
    records: CustomerImportRecord[],
  ): Promise<{ phones: Set<string>; emails: Set<string>; nameBirthdays: Set<string> }> {
    const phones = new Set<string>();
    const emails = new Set<string>();
    const nameBirthdays = new Set<string>();
    const phoneValues = [...new Set(records.map((record) => record.phoneNormalized))];
    const emailValues = [...new Set(records.flatMap((record) => record.emailNormalized ? [record.emailNormalized] : []))];
    const nameBirthdayValues = new Map<string, { normalizedName: string; dateOfBirth: Date }>();

    for (const record of records) {
      if (record.dateOfBirth) {
        nameBirthdayValues.set(`${record.normalizedName}\u0000${dateKey(record.dateOfBirth)}`, {
          normalizedName: record.normalizedName,
          dateOfBirth: record.dateOfBirth,
        });
      }
    }

    for (const group of chunks(phoneValues, 500)) {
      const matches = await tx.customer.findMany({
        where: { phoneNormalized: { in: group } },
        select: { phoneNormalized: true },
      });
      for (const match of matches) phones.add(match.phoneNormalized);
    }
    for (const group of chunks(emailValues, 500)) {
      const matches = await tx.customer.findMany({
        where: { emailNormalized: { in: group } },
        select: { emailNormalized: true },
      });
      for (const match of matches) {
        if (match.emailNormalized) emails.add(match.emailNormalized);
      }
    }
    const nameBirthdayPairs = [...nameBirthdayValues.values()];
    for (const group of chunks(nameBirthdayPairs, 250)) {
      const matches = await tx.customer.findMany({
        where: {
          OR: group.map(({ normalizedName, dateOfBirth }) => ({ normalizedName, dateOfBirth })),
        },
        select: { normalizedName: true, dateOfBirth: true },
      });
      for (const match of matches) {
        if (match.dateOfBirth) nameBirthdays.add(`${match.normalizedName}\u0000${dateKey(match.dateOfBirth)}`);
      }
    }

    return { phones, emails, nameBirthdays };
  }

  private async failBatch(
    batch: { id: string; branchId: string; createdById: string },
    errorCode: string,
    failedInsertRows: number,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const current = await tx.customerImportBatch.findUnique({ where: { id: batch.id } });
      if (!current || TERMINAL_STATUSES.has(current.status) ||
        current.status === CustomerImportBatchStatus.COMMITTING) return;
      const transition = await tx.customerImportBatch.updateMany({
        where: { id: batch.id, status: current.status },
        data: {
          status: CustomerImportBatchStatus.FAILED,
          importedRows: 0,
          duplicateRows: 0,
          failedInsertRows,
          totalRows: 0,
          validRows: 0,
          invalidRows: 0,
          skippedRows: 0,
          tempFileKey: null,
          fileSha256: null,
          columnMapping: {},
          selectedSheet: null,
          errorCode,
          completedAt: new Date(),
        },
      });
      if (transition.count !== 1) return;

      await tx.customerImportRow.deleteMany({ where: { batchId: batch.id } });
      await this.audit.write(tx, {
        actor: this.actor(batch.createdById),
        action: 'customer.import.failed',
        targetType: 'customer-import-batch',
        targetId: batch.id,
        branchId: batch.branchId,
        afterState: { importedRows: 0, duplicateRows: 0, failedInsertRows },
      });
    });
  }

  private actor(id: string): ActorContext {
    return { id, type: 'STAFF' };
  }
}
