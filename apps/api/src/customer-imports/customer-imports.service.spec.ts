import { CustomerImportBatchStatus } from '../generated/prisma/client.js';
import { CustomerImportsService } from './customer-imports.service.js';

describe('CustomerImportsService', () => {
  function service(
    storageWritable: boolean,
    scannerAvailable: boolean,
    queueReady = true,
    workerAvailable = true,
    importSchemaReady = true,
  ) {
    const service = new CustomerImportsService(
      { $queryRaw: async () => [{ ready: importSchemaReady }] } as never,
      {} as never,
      {
        enqueue: async () => { throw new Error('not used'); },
        isReady: async () => queueReady,
        hasWorkers: async () => workerAvailable,
      },
      {
        isWritable: async () => storageWritable,
        writeUpload: async () => { throw new Error('not used'); },
        remove: async () => undefined,
      },
      { isAvailable: async () => scannerAvailable },
    );
    return service;
  }

  it('reports readiness when storage, scanner, queue, and worker are available', async () => {
    await expect(service(true, true).getReadiness()).resolves.toEqual({
      ready: true,
      status: 'READY',
      missingRequirements: [],
      messageVi: 'Có thể tải tệp lên; hệ thống sẽ quét và tự động nhập nếu dữ liệu hợp lệ.',
    });
  });

  it('reports missing dependencies without opening the import flow', async () => {
    await expect(service(false, false, false).getReadiness()).resolves.toMatchObject({
      ready: false,
      status: 'BLOCKED',
      missingRequirements: expect.arrayContaining([
        'LOCAL_TEMP_STORAGE_UNAVAILABLE',
        'CLAMAV_SCANNER_UNAVAILABLE',
        'IMPORT_QUEUE_UNAVAILABLE',
      ]),
    });
  });

  it('keeps readiness blocked when no worker is registered', async () => {
    await expect(service(true, true, true, false).getReadiness()).resolves.toMatchObject({
      ready: false,
      status: 'BLOCKED',
      missingRequirements: ['IMPORT_WORKER_UNAVAILABLE'],
    });
  });

  it('keeps readiness blocked until the partial-import retention migration is applied', async () => {
    await expect(service(true, true, true, true, false).getReadiness()).resolves.toMatchObject({
      ready: false,
      status: 'BLOCKED',
      missingRequirements: ['IMPORT_SCHEMA_NOT_READY'],
    });
  });

  it('returns only sanitized failed-row numbers while their retention window is open', async () => {
    const batch = {
      id: '60c9d172-16a5-43ef-b5ec-1334f7bd4d27',
      branchId: '5f7103b2-94f2-4d4d-a5af-e7a71b4a1ac5',
      status: CustomerImportBatchStatus.COMPLETED,
      importedRows: 1,
      duplicateRows: 0,
      invalidRows: 1,
      failedInsertRows: 0,
      errorCode: null,
      failureDetailsExpiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date(),
      completedAt: new Date(),
      rows: [{
        rowNumber: 3,
        validationErrors: ['INVALID_PHONE', 'customer@example.com'],
      }],
    };
    const imports = new CustomerImportsService(
      { customerImportBatch: { findUnique: async () => batch } } as never,
      { assertPermission: async () => undefined } as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(imports.getBatch({ id: 'actor-id', type: 'STAFF' }, batch.id)).resolves.toMatchObject({
      importedRows: 1,
      invalidRows: 1,
      failedRows: [{ rowNumber: 3, errorCodes: ['INVALID_PHONE'] }],
      failureDetailsExpired: false,
    });
  });

  it('hides failed-row details after their retention window expires', async () => {
    const batch = {
      id: '60c9d172-16a5-43ef-b5ec-1334f7bd4d27',
      branchId: '5f7103b2-94f2-4d4d-a5af-e7a71b4a1ac5',
      status: CustomerImportBatchStatus.COMPLETED,
      importedRows: 1,
      duplicateRows: 0,
      invalidRows: 1,
      failedInsertRows: 0,
      errorCode: null,
      failureDetailsExpiresAt: new Date(Date.now() - 60_000),
      createdAt: new Date(),
      completedAt: new Date(),
      rows: [{ rowNumber: 3, validationErrors: ['INVALID_PHONE'] }],
    };
    const imports = new CustomerImportsService(
      { customerImportBatch: { findUnique: async () => batch } } as never,
      { assertPermission: async () => undefined } as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(imports.getBatch({ id: 'actor-id', type: 'STAFF' }, batch.id)).resolves.toMatchObject({
      invalidRows: 1,
      failedRows: [],
      failureDetailsExpired: true,
    });
  });

  it('reports expired details for rows rolled back by a database failure', async () => {
    const batch = {
      id: '60c9d172-16a5-43ef-b5ec-1334f7bd4d27',
      branchId: '5f7103b2-94f2-4d4d-a5af-e7a71b4a1ac5',
      status: CustomerImportBatchStatus.FAILED,
      importedRows: 0,
      duplicateRows: 0,
      invalidRows: 0,
      failedInsertRows: 2,
      errorCode: 'IMPORT_PROCESSING_FAILED',
      failureDetailsExpiresAt: null,
      createdAt: new Date(),
      completedAt: new Date(),
      rows: [],
    };
    const imports = new CustomerImportsService(
      { customerImportBatch: { findUnique: async () => batch } } as never,
      { assertPermission: async () => undefined } as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(imports.getBatch({ id: 'actor-id', type: 'STAFF' }, batch.id)).resolves.toMatchObject({
      failedInsertRows: 2,
      failedRows: [],
      failureDetailsExpired: true,
    });
  });
});
