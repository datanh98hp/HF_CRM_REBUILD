import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  Inject,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { extname } from 'node:path';
import {
  CustomerImportBatchStatus,
  CustomerImportRowStatus,
} from '../generated/prisma/client.js';
import { AccessControlService } from '../access-control/access-control.service.js';
import { ActorContext } from '../common/actor-context.js';
import { BackgroundQueueService } from '../background-queue/background-queue.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { ClamAvScannerService } from './clamav-scanner.service.js';
import { CUSTOMER_IMPORT_MAX_BYTES, type CustomerImportFileFormat } from './customer-import-parser.js';
import { CustomerImportTempStorageService } from './customer-import-temp-storage.service.js';

const QUEUE_JOB = 'customer-import.process';
const SAFE_IMPORT_ERROR_CODES = new Set([
  'FULL_NAME_REQUIRED',
  'INVALID_FULL_NAME',
  'PHONE_REQUIRED',
  'INVALID_PHONE',
  'INVALID_EMAIL',
  'INVALID_DATE_OF_BIRTH',
  'DATABASE_INSERT_FAILED',
]);
const TERMINAL_STATUSES = new Set<CustomerImportBatchStatus>([
  CustomerImportBatchStatus.COMPLETED,
  CustomerImportBatchStatus.FAILED,
  CustomerImportBatchStatus.CANCELLED,
  CustomerImportBatchStatus.EXPIRED,
]);

export interface CustomerImportReadiness {
  ready: boolean;
  status: 'READY' | 'BLOCKED';
  missingRequirements: string[];
  messageVi: string;
}

export interface CustomerImportUpload {
  originalname: string;
  size: number;
  buffer: Buffer;
}

export interface CreateCustomerImportBatchInput {
  branchId: string;
}

@Injectable()
export class CustomerImportsService {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: Pick<PrismaService, '$queryRaw' | 'customerImportBatch' | 'branch'>,
    @Inject(AccessControlService)
    private readonly access: Pick<AccessControlService, 'assertPermission'>,
    @Inject(BackgroundQueueService)
    private readonly queue: Pick<BackgroundQueueService, 'enqueue' | 'isReady' | 'hasWorkers'>,
    @Inject(CustomerImportTempStorageService)
    private readonly storage: Pick<CustomerImportTempStorageService, 'isWritable' | 'writeUpload' | 'remove'>,
    @Inject(ClamAvScannerService)
    private readonly scanner: Pick<ClamAvScannerService, 'isAvailable'>,
  ) {}

  async getReadiness(): Promise<CustomerImportReadiness> {
    const missingRequirements: string[] = [];
    await this.prisma.$queryRaw`SELECT 1`;
    const importSchema = await this.prisma.$queryRaw<Array<{ ready: boolean }>>`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'CustomerImportBatch'
          AND column_name = 'failureDetailsExpiresAt'
      ) AS ready
    `;
    if (!importSchema[0]?.ready) {
      missingRequirements.push('IMPORT_SCHEMA_NOT_READY');
    }
    if (!(await this.storage.isWritable())) {
      missingRequirements.push('LOCAL_TEMP_STORAGE_UNAVAILABLE');
    }
    if (!(await this.scanner.isAvailable())) {
      missingRequirements.push('CLAMAV_SCANNER_UNAVAILABLE');
    }
    if (!(await this.queue.isReady())) {
      missingRequirements.push('IMPORT_QUEUE_UNAVAILABLE');
    } else if (!(await this.queue.hasWorkers())) {
      missingRequirements.push('IMPORT_WORKER_UNAVAILABLE');
    }

    const ready = missingRequirements.length === 0;
    return {
      ready,
      status: ready ? 'READY' : 'BLOCKED',
      missingRequirements,
      messageVi: ready
        ? 'Có thể tải tệp lên; hệ thống sẽ quét và tự động nhập nếu dữ liệu hợp lệ.'
        : 'Chưa thể tải tệp lên vì một hoặc nhiều dịch vụ nhập dữ liệu chưa sẵn sàng.',
    };
  }

  async createBatch(
    actor: ActorContext,
    input: CreateCustomerImportBatchInput,
    file: CustomerImportUpload | undefined,
    idempotencyKey: string | undefined,
  ) {
    this.assertStaff(actor);
    if (!file?.buffer?.length) throw new BadRequestException({ code: 'IMPORT_FILE_REQUIRED' });
    if (file.size > CUSTOMER_IMPORT_MAX_BYTES || file.buffer.length > CUSTOMER_IMPORT_MAX_BYTES) {
      throw new BadRequestException({ code: 'FILE_SIZE_LIMIT_EXCEEDED' });
    }
    const requestKey = idempotencyKey?.trim();
    if (!requestKey || requestKey.length > 128) {
      throw new BadRequestException({ code: 'IDEMPOTENCY_KEY_REQUIRED' });
    }

    const extension = extname(file.originalname).toLowerCase();
    if (extension !== '.csv' && extension !== '.xlsx') {
      throw new BadRequestException({ code: 'UNSUPPORTED_FILE_TYPE' });
    }
    const format: CustomerImportFileFormat = extension === '.csv' ? 'csv' : 'xlsx';

    const existing = await this.prisma.customerImportBatch.findUnique({
      where: { createdById_idempotencyKey: { createdById: actor.id, idempotencyKey: requestKey } },
    });
    if (existing) {
      if (existing.branchId !== input.branchId) {
        throw new ConflictException({ code: 'IDEMPOTENCY_KEY_REUSED' });
      }
      return this.serializeBatch(existing);
    }

    await this.access.assertPermission(actor.id, 'customers.import', undefined, input.branchId);
    const branch = await this.prisma.branch.findFirst({
      where: { id: input.branchId, status: 'ACTIVE' },
      select: { id: true },
    });
    if (!branch) throw new NotFoundException({ code: 'BRANCH_NOT_FOUND' });

    const readiness = await this.getReadiness();
    if (!readiness.ready) {
      throw new ServiceUnavailableException({
        code: 'CUSTOMER_IMPORT_NOT_READY',
        requirements: readiness.missingRequirements,
      });
    }

    const temporaryFile = await this.storage.writeUpload(file.buffer);
    const sha256 = createHash('sha256').update(file.buffer).digest('hex');
    let batch;
    try {
      batch = await this.prisma.customerImportBatch.create({
        data: {
          branchId: input.branchId,
          createdById: actor.id,
          idempotencyKey: requestKey,
          tempFileKey: temporaryFile.storageKey,
          fileSha256: sha256,
          columnMapping: { fileFormat: format },
          status: CustomerImportBatchStatus.QUEUED,
        },
      });
    } catch (error) {
      await this.storage.remove(temporaryFile.storageKey);
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'P2002'
      ) {
        const duplicate = await this.prisma.customerImportBatch.findUnique({
          where: { createdById_idempotencyKey: { createdById: actor.id, idempotencyKey: requestKey } },
        });
        if (duplicate?.branchId === input.branchId) return this.serializeBatch(duplicate);
        throw new ConflictException({ code: 'IDEMPOTENCY_KEY_REUSED' });
      }
      throw error;
    }

    try {
      await this.queue.enqueue(QUEUE_JOB, { batchId: batch.id, format }, batch.id);
    } catch (error) {
      await this.storage.remove(temporaryFile.storageKey);
      await this.markEnqueueFailure(batch.id);
      throw new ServiceUnavailableException({ code: 'IMPORT_QUEUE_UNAVAILABLE' }, { cause: error });
    }

    return this.serializeBatch(batch);
  }

  async getHistory(actor: ActorContext) {
    this.assertStaff(actor);
    const batches = await this.prisma.customerImportBatch.findMany({
      where: { createdById: actor.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return batches.map((batch) => this.serializeBatch(batch));
  }

  async getBatch(actor: ActorContext, batchId: string) {
    this.assertStaff(actor);
    const batch = await this.prisma.customerImportBatch.findUnique({
      where: { id: batchId },
      include: {
        rows: {
          where: { status: CustomerImportRowStatus.INVALID },
          orderBy: { rowNumber: 'asc' },
          select: { rowNumber: true, validationErrors: true },
        },
      },
    });
    if (!batch) throw new NotFoundException({ code: 'IMPORT_BATCH_NOT_FOUND' });
    await this.access.assertPermission(actor.id, 'customers.import', undefined, batch.branchId);
    const failureDetailsAvailable = batch.failureDetailsExpiresAt !== null &&
      batch.failureDetailsExpiresAt > new Date();
    return {
      ...this.serializeBatch(batch),
      failedRows: failureDetailsAvailable
        ? batch.rows.map(({ rowNumber, validationErrors }) => ({
          rowNumber,
          errorCodes: this.errorCodes(validationErrors),
        }))
        : [],
      failureDetailsExpired: batch.invalidRows + batch.failedInsertRows > 0 && !failureDetailsAvailable,
    };
  }

  private async markEnqueueFailure(batchId: string): Promise<void> {
    const batch = await this.prisma.customerImportBatch.findUnique({ where: { id: batchId } });
    if (!batch || TERMINAL_STATUSES.has(batch.status)) return;
    await this.prisma.customerImportBatch.update({
      where: { id: batchId },
      data: {
        status: CustomerImportBatchStatus.FAILED,
        tempFileKey: null,
        fileSha256: null,
        columnMapping: {},
        selectedSheet: null,
        errorCode: 'IMPORT_QUEUE_UNAVAILABLE',
        completedAt: new Date(),
      },
    });
  }

  private serializeBatch(batch: {
    id: string;
    status: CustomerImportBatchStatus;
    importedRows: number;
    duplicateRows: number;
    invalidRows: number;
    failedInsertRows: number;
    errorCode: string | null;
    failureDetailsExpiresAt: Date | null;
    createdAt: Date;
    completedAt: Date | null;
  }) {
    return {
      id: batch.id,
      status: batch.status,
      importedRows: batch.importedRows,
      duplicateRows: batch.duplicateRows,
      invalidRows: batch.invalidRows,
      failedInsertRows: batch.failedInsertRows,
      errorCode: batch.errorCode,
      failureDetailsExpiresAt: batch.failureDetailsExpiresAt?.toISOString() ?? null,
      createdAt: batch.createdAt,
      completedAt: batch.completedAt,
    };
  }

  private errorCodes(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.filter((code): code is string =>
      typeof code === 'string' && SAFE_IMPORT_ERROR_CODES.has(code),
    );
  }

  private assertStaff(actor: ActorContext): void {
    if (actor.type !== 'STAFF') throw new ForbiddenException({ code: 'STAFF_PERMISSION_REQUIRED' });
  }
}
