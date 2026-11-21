import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { CustomerImportBatchStatus, CustomerImportRowStatus } from '../generated/prisma/client.js';
import { CustomerImportWorkerService } from './customer-import-worker.service.js';
import { CustomerImportTempStorageService } from './customer-import-temp-storage.service.js';

function asyncMock<Args extends unknown[], Result>(
  implementation?: (...args: Args) => Promise<Result>,
) {
  return jest.fn<(...args: Args) => Promise<Result>>(implementation);
}

describe('CustomerImportWorkerService', () => {
  let directory: string;
  let storage: CustomerImportTempStorageService;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'customer-import-worker-'));
    storage = new CustomerImportTempStorageService(directory);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await rm(directory, { recursive: true, force: true });
  });

  async function createUpload(
    data = Buffer.from('Họ tên,Số điện thoại,Email,Ngày sinh\nNguyễn Thị Lan Anh,0912345678,,1992-03-14\n'),
  ) {
    const target = await storage.createUploadTarget();
    await writeFile(target.path, data);
    const batch: {
      id: string;
      branchId: string;
      createdById: string;
      tempFileKey: string;
      fileSha256: string;
      status: CustomerImportBatchStatus;
    } = {
      id: '60c9d172-16a5-43ef-b5ec-1334f7bd4d27',
      branchId: '5f7103b2-94f2-4d4d-a5af-e7a71b4a1ac5',
      createdById: '4bf92b1d-7b11-4aa9-858e-cd9b499a8d7f',
      tempFileKey: target.storageKey,
      fileSha256: createHash('sha256').update(data).digest('hex'),
      status: CustomerImportBatchStatus.QUEUED,
    };
    return {
      data,
      target,
      batch,
    };
  }

  it('scans, imports clean data atomically, records counts, and deletes the temporary file', async () => {
    const { target, batch } = await createUpload(Buffer.from(
      'Họ tên,Số điện thoại,CCCD,Địa chỉ,Quê quán,Giới tính,Nơi cấp\n' +
      'Nguyễn Thị Lan Anh,0912345678,001234567890,12 Nguyễn Trãi,Hà Nam,Nữ,Cục Cảnh sát\n',
      'utf8',
    ));
    let updateManyCalls = 0;
    let fileDeletedBeforeCompletion = false;
    const transaction = {
      customerImportBatch: {
        findUnique: asyncMock<[], unknown>().mockResolvedValue({
          ...batch,
          status: CustomerImportBatchStatus.COMMITTING,
          importedRows: 1,
          duplicateRows: 0,
          failedInsertRows: 0,
        }),
        updateMany: asyncMock<[input: unknown], unknown>().mockImplementation(async () => {
          updateManyCalls += 1;
          if (updateManyCalls === 2) {
            await expect(readFile(target.path)).rejects.toMatchObject({ code: 'ENOENT' });
            fileDeletedBeforeCompletion = true;
          }
          return { count: 1 };
        }),
        update: asyncMock<[input: unknown], unknown>().mockResolvedValue({}),
      },
      customerImportRow: {
        deleteMany: asyncMock<[], unknown>().mockResolvedValue({ count: 0 }),
        createMany: asyncMock<[], unknown>().mockResolvedValue({ count: 0 }),
      },
      customer: {
        findMany: asyncMock<[], unknown[]>().mockResolvedValue([]),
        createMany: asyncMock<[input: unknown], unknown>(async () => {
          await expect(readFile(target.path)).resolves.toBeTruthy();
          return { count: 1 };
        }),
      },
    };
    const prisma = {
      customerImportBatch: {
        findUnique: asyncMock<[], unknown>().mockResolvedValue(batch),
        update: asyncMock<[input: unknown], unknown>().mockResolvedValue({}),
      },
      $transaction: jest.fn(async (callback: (tx: typeof transaction) => Promise<unknown>) =>
        callback(transaction),
      ),
    };
    const audit = { write: asyncMock<unknown[], unknown>().mockResolvedValue({}) };
    const scanner = { scanFile: asyncMock<[path: string], string>().mockResolvedValue('CLEAN') };
    const worker = new CustomerImportWorkerService(
      prisma as never,
      audit as never,
      scanner as never,
      storage,
    );

    await expect(worker.process(batch.id, 'csv')).resolves.toEqual({
      status: CustomerImportBatchStatus.COMPLETED,
    });
    expect(scanner.scanFile).toHaveBeenCalledWith(target.path);
    expect(audit.write).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      afterState: { importedRows: 1, duplicateRows: 0, failedInsertRows: 0 },
    }));
    expect(transaction.customer.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        fullName: 'Nguyễn Thị Lan Anh',
        phoneNormalized: '0912345678',
        cccd: '001234567890',
        address: '12 Nguyễn Trãi',
        placeOfOrigin: 'Hà Nam',
        sex: 'Nữ',
        placeOfIssue: 'Cục Cảnh sát',
        provenance: 'IMPORT',
        branchId: batch.branchId,
        createdById: batch.createdById,
      })],
    });
    expect(transaction.customerImportBatch.updateMany).toHaveBeenNthCalledWith(2, {
      where: { id: batch.id, status: CustomerImportBatchStatus.COMMITTING },
      data: expect.objectContaining({
        status: CustomerImportBatchStatus.COMPLETED,
        columnMapping: {},
        tempFileKey: null,
        fileSha256: null,
        totalRows: 0,
        validRows: 0,
        skippedRows: 0,
      }),
    });
    expect(fileDeletedBeforeCompletion).toBe(true);
    await expect(readFile(target.path)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('imports valid rows and retains only row numbers and error codes for invalid rows', async () => {
    const data = Buffer.from(
      'TT,Họ tên,Số điện thoại,Email,Ngày sinh\n' +
      '1,Nguyễn Thị Lan Anh,0912345678,,1992-03-14\n' +
      '2,,123,,\n' +
      '3,Trần Quốc Bảo,0912345679,,1990-01-01\n',
    );
    const { target, batch } = await createUpload(data);
    const failureCreateMany = asyncMock<[input: { data: unknown[] }], unknown>().mockResolvedValue({ count: 1 });
    const transaction = {
      customerImportBatch: {
        findUnique: asyncMock<[], unknown>().mockResolvedValue({
          ...batch,
          status: CustomerImportBatchStatus.COMMITTING,
          importedRows: 2,
          duplicateRows: 0,
          invalidRows: 1,
          failedInsertRows: 0,
        }),
        updateMany: asyncMock<[input: unknown], unknown>().mockResolvedValue({ count: 1 }),
        update: asyncMock<[input: unknown], unknown>().mockResolvedValue({}),
      },
      customerImportRow: {
        deleteMany: asyncMock<[], unknown>().mockResolvedValue({ count: 0 }),
        createMany: failureCreateMany,
      },
      customer: {
        findMany: asyncMock<[], unknown[]>().mockResolvedValue([]),
        createMany: asyncMock<[input: { data: unknown[] }], unknown>().mockResolvedValue({ count: 2 }),
      },
    };
    const prisma = {
      customerImportBatch: {
        findUnique: asyncMock<[], unknown>().mockResolvedValue(batch),
        update: asyncMock<[input: unknown], unknown>().mockResolvedValue({}),
      },
      $transaction: jest.fn(async (callback: (tx: typeof transaction) => Promise<unknown>) =>
        callback(transaction),
      ),
    };
    const audit = { write: asyncMock<unknown[], unknown>().mockResolvedValue({}) };
    const scanner = { scanFile: asyncMock<[path: string], string>().mockResolvedValue('CLEAN') };
    const worker = new CustomerImportWorkerService(
      prisma as never,
      audit as never,
      scanner as never,
      storage,
    );

    await expect(worker.process(batch.id, 'csv')).resolves.toEqual({
      status: CustomerImportBatchStatus.COMPLETED,
    });
    expect(transaction.customer.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ fullName: 'Nguyễn Thị Lan Anh' }),
        expect.objectContaining({ fullName: 'Trần Quốc Bảo' }),
      ],
    });
    expect(failureCreateMany).toHaveBeenCalledWith({
      data: [{
        batchId: batch.id,
        rowNumber: 3,
        status: CustomerImportRowStatus.INVALID,
        validationErrors: ['FULL_NAME_REQUIRED', 'INVALID_PHONE'],
      }],
    });
    expect(transaction.customerImportBatch.update).toHaveBeenCalledWith({
      where: { id: batch.id },
      data: expect.objectContaining({
        importedRows: 2,
        invalidRows: 1,
        totalRows: 3,
        validRows: 2,
      }),
    });
    const completionUpdate = transaction.customerImportBatch.updateMany.mock.calls[1][0] as {
      data: Record<string, unknown>;
    };
    expect(completionUpdate.data).toEqual(expect.objectContaining({
      status: CustomerImportBatchStatus.COMPLETED,
      totalRows: 0,
      validRows: 0,
      skippedRows: 0,
    }));
    expect(completionUpdate.data).not.toHaveProperty('invalidRows');
    expect(audit.write).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      afterState: {
        importedRows: 2,
        duplicateRows: 0,
        invalidRows: 1,
        failedInsertRows: 0,
      },
    }));
    await expect(readFile(target.path)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('skips duplicates found in the database and reports the skipped count', async () => {
    const { target, batch } = await createUpload();
    const transaction = {
      customerImportBatch: {
        findUnique: asyncMock<[], unknown>().mockResolvedValue({
          ...batch,
          status: CustomerImportBatchStatus.COMMITTING,
          importedRows: 0,
          duplicateRows: 1,
          failedInsertRows: 0,
        }),
        updateMany: asyncMock<[input: unknown], unknown>().mockResolvedValue({ count: 1 }),
        update: asyncMock<[input: unknown], unknown>().mockResolvedValue({}),
      },
      customerImportRow: {
        deleteMany: asyncMock<[], unknown>().mockResolvedValue({ count: 0 }),
        createMany: asyncMock<[], unknown>().mockResolvedValue({ count: 0 }),
      },
      customer: {
        findMany: asyncMock<[query: { where: Record<string, unknown> }], unknown[]>(async (query) => {
          if ('phoneNormalized' in query.where) {
            return [{
              normalizedName: 'nguyen thi lan anh',
              phoneNormalized: '0912345678',
            }];
          }
          return [];
        }),
        createMany: jest.fn(),
      },
    };
    const prisma = {
      customerImportBatch: {
        findUnique: asyncMock<[], unknown>().mockResolvedValue(batch),
        update: asyncMock<[input: unknown], unknown>().mockResolvedValue({}),
      },
      $transaction: jest.fn(async (callback: (tx: typeof transaction) => Promise<unknown>) =>
        callback(transaction),
      ),
    };
    const audit = { write: asyncMock<unknown[], unknown>().mockResolvedValue({}) };
    const scanner = { scanFile: asyncMock<[path: string], string>().mockResolvedValue('CLEAN') };
    const worker = new CustomerImportWorkerService(
      prisma as never,
      audit as never,
      scanner as never,
      storage,
    );

    await expect(worker.process(batch.id, 'csv')).resolves.toEqual({
      status: CustomerImportBatchStatus.COMPLETED,
    });
    expect(transaction.customer.createMany).not.toHaveBeenCalled();
    expect(transaction.customerImportBatch.updateMany).toHaveBeenNthCalledWith(2, {
      where: { id: batch.id, status: CustomerImportBatchStatus.COMMITTING },
      data: expect.objectContaining({
        status: CustomerImportBatchStatus.COMPLETED,
      }),
    });
    await expect(readFile(target.path)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('skips repeated name and phone pairs in a batch but allows the same phone for another name', async () => {
    const data = Buffer.from(
      'Họ tên,Số điện thoại\n' +
      'Nguyễn Thị Lan Anh,0912345678\n' +
      'Trần Quốc Bảo,0912345678\n' +
      ' Nguyen   Thi Lan Anh ,0912345678\n',
    );
    const { target, batch } = await createUpload(data);
    const transaction = {
      customerImportBatch: {
        findUnique: asyncMock<[], unknown>().mockResolvedValue({
          ...batch,
          status: CustomerImportBatchStatus.COMMITTING,
          importedRows: 2,
          duplicateRows: 1,
          failedInsertRows: 0,
        }),
        updateMany: asyncMock<[input: unknown], unknown>().mockResolvedValue({ count: 1 }),
        update: asyncMock<[input: unknown], unknown>().mockResolvedValue({}),
      },
      customerImportRow: {
        deleteMany: asyncMock<[], unknown>().mockResolvedValue({ count: 0 }),
        createMany: asyncMock<[], unknown>().mockResolvedValue({ count: 0 }),
      },
      customer: {
        findMany: asyncMock<[], unknown[]>().mockResolvedValue([]),
        createMany: asyncMock<[input: { data: { fullName: string }[] }], unknown>()
          .mockResolvedValue({ count: 2 }),
      },
    };
    const prisma = {
      customerImportBatch: {
        findUnique: asyncMock<[], unknown>().mockResolvedValue(batch),
        update: asyncMock<[input: unknown], unknown>().mockResolvedValue({}),
      },
      $transaction: jest.fn(async (callback: (tx: typeof transaction) => Promise<unknown>) =>
        callback(transaction),
      ),
    };
    const worker = new CustomerImportWorkerService(
      prisma as never,
      { write: asyncMock<unknown[], unknown>().mockResolvedValue({}) } as never,
      { scanFile: asyncMock<[path: string], string>().mockResolvedValue('CLEAN') } as never,
      storage,
    );

    await expect(worker.process(batch.id, 'csv')).resolves.toEqual({
      status: CustomerImportBatchStatus.COMPLETED,
    });
    expect(transaction.customer.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ fullName: 'Nguyễn Thị Lan Anh' }),
        expect.objectContaining({ fullName: 'Trần Quốc Bảo' }),
      ],
    });
    expect(transaction.customerImportBatch.update).toHaveBeenCalledWith({
      where: { id: batch.id },
      data: expect.objectContaining({
        importedRows: 2,
        duplicateRows: 1,
      }),
    });
    await expect(readFile(target.path)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('resumes cleanup without importing again if deletion fails after the database commit', async () => {
    const { target, batch } = await createUpload();
    const transaction = {
      customerImportBatch: {
        findUnique: jest.fn().mockImplementation(async () => batch),
        updateMany: jest.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
          Object.assign(batch, data);
          return { count: 1 };
        }),
        update: jest.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
          Object.assign(batch, data);
          return batch;
        }),
      },
      customerImportRow: {
        deleteMany: asyncMock<[], unknown>().mockResolvedValue({ count: 0 }),
        createMany: asyncMock<[], unknown>().mockResolvedValue({ count: 0 }),
      },
      customer: {
        findMany: asyncMock<[], unknown[]>().mockResolvedValue([]),
        createMany: asyncMock<[], unknown>().mockResolvedValue({ count: 1 }),
      },
    };
    const prisma = {
      customerImportBatch: {
        findUnique: jest.fn().mockImplementation(async () => batch),
        update: asyncMock<[input: unknown], unknown>().mockResolvedValue({}),
      },
      $transaction: jest.fn(async (callback: (tx: typeof transaction) => Promise<unknown>) =>
        callback(transaction),
      ),
    };
    const audit = { write: asyncMock<unknown[], unknown>().mockResolvedValue({}) };
    const scanner = { scanFile: asyncMock<[path: string], string>().mockResolvedValue('CLEAN') };
    const remove = jest.spyOn(storage, 'remove').mockImplementationOnce(async () => {
      throw new Error('Temporary file deletion failed');
    });
    const worker = new CustomerImportWorkerService(
      prisma as never,
      audit as never,
      scanner as never,
      storage,
    );

    await expect(worker.process(batch.id, 'csv')).rejects.toThrow('Temporary file deletion failed');
    expect(batch.status).toBe(CustomerImportBatchStatus.COMMITTING);
    await expect(readFile(target.path)).resolves.toBeTruthy();

    await expect(worker.process(batch.id, 'csv')).resolves.toEqual({
      status: CustomerImportBatchStatus.COMPLETED,
    });
    expect(scanner.scanFile).toHaveBeenCalledTimes(1);
    expect(transaction.customer.createMany).toHaveBeenCalledTimes(1);
    expect(audit.write).toHaveBeenCalledTimes(1);
    await expect(readFile(target.path)).rejects.toMatchObject({ code: 'ENOENT' });
    remove.mockRestore();
  });

  it('records an infected scan as a failed batch and deletes its file without inserting customers', async () => {
    const { target, batch } = await createUpload();
    const transaction = {
      customerImportBatch: {
        findUnique: asyncMock<[], unknown>().mockResolvedValue(batch),
        updateMany: asyncMock<[input: unknown], unknown>().mockResolvedValue({ count: 1 }),
        update: asyncMock<[input: unknown], unknown>().mockResolvedValue({}),
      },
      customerImportRow: {
        deleteMany: asyncMock<[], unknown>().mockResolvedValue({ count: 0 }),
        createMany: asyncMock<[], unknown>().mockResolvedValue({ count: 0 }),
      },
      customer: {
        findMany: jest.fn(),
        createMany: jest.fn(),
      },
    };
    const prisma = {
      customerImportBatch: {
        findUnique: asyncMock<[], unknown>().mockResolvedValue(batch),
        update: asyncMock<[input: unknown], unknown>().mockResolvedValue({}),
      },
      $transaction: jest.fn(async (callback: (tx: typeof transaction) => Promise<unknown>) =>
        callback(transaction),
      ),
    };
    const audit = { write: asyncMock<unknown[], unknown>().mockResolvedValue({}) };
    const scanner = { scanFile: asyncMock<[path: string], string>().mockResolvedValue('INFECTED') };
    const worker = new CustomerImportWorkerService(
      prisma as never,
      audit as never,
      scanner as never,
      storage,
    );

    await expect(worker.process(batch.id, 'csv')).resolves.toEqual({
      status: CustomerImportBatchStatus.FAILED,
    });
    expect(transaction.customer.createMany).not.toHaveBeenCalled();
    expect(transaction.customerImportBatch.updateMany).toHaveBeenCalledWith({
      where: { id: batch.id, status: CustomerImportBatchStatus.QUEUED },
      data: expect.objectContaining({
        status: CustomerImportBatchStatus.FAILED,
        errorCode: 'FILE_INFECTED',
        importedRows: 0,
        duplicateRows: 0,
        failedInsertRows: 0,
        tempFileKey: null,
        fileSha256: null,
      }),
    });
    await expect(readFile(target.path)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('purges expired invalid-row details while retaining the batch counts', async () => {
    const now = new Date('2026-12-20T12:00:00.000Z');
    const transaction = {
      customerImportRow: {
        deleteMany: asyncMock<[input: unknown], { count: number }>().mockResolvedValue({ count: 2 }),
      },
      customerImportBatch: {
        updateMany: asyncMock<[input: unknown], unknown>().mockResolvedValue({ count: 1 }),
      },
    };
    const prisma = {
      customerImportBatch: {
        findMany: asyncMock<[input: unknown], { id: string }[]>().mockResolvedValue([{ id: 'expired-batch' }]),
      },
      $transaction: jest.fn(async (callback: (tx: typeof transaction) => Promise<number>) =>
        callback(transaction),
      ),
    };
    const worker = new CustomerImportWorkerService(
      prisma as never,
      { write: asyncMock<unknown[], unknown>().mockResolvedValue({}) } as never,
      { scanFile: asyncMock<[path: string], string>().mockResolvedValue('CLEAN') } as never,
      storage,
    );

    await expect(worker.cleanupExpiredFailureDetails(now)).resolves.toBe(2);
    expect(transaction.customerImportRow.deleteMany).toHaveBeenCalledWith({
      where: { batchId: { in: ['expired-batch'] }, status: CustomerImportRowStatus.INVALID },
    });
    expect(transaction.customerImportBatch.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['expired-batch'] }, failureDetailsExpiresAt: { lte: now } },
      data: { failureDetailsExpiresAt: null },
    });
  });
});
