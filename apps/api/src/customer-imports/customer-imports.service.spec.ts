import { CustomerImportsService } from './customer-imports.service.js';

describe('CustomerImportsService', () => {
  function service(
    storageWritable: boolean,
    scannerAvailable: boolean,
    queueReady = true,
    workerAvailable = true,
  ) {
    const service = new CustomerImportsService(
      { $queryRaw: async () => 1 } as never,
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
});
