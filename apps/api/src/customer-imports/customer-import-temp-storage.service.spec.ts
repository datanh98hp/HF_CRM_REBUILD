import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CustomerImportTempStorageService } from './customer-import-temp-storage.service.js';

describe('CustomerImportTempStorageService', () => {
  let directory: string;
  let storage: CustomerImportTempStorageService;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'customer-import-'));
    storage = new CustomerImportTempStorageService(directory);
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('creates opaque upload paths and removes files after successful processing', async () => {
    const target = await storage.createUploadTarget();
    await writeFile(target.path, 'synthetic data');

    await expect(
      storage.processAndDelete(target.storageKey, async (path) => readFile(path, 'utf8')),
    ).resolves.toBe('synthetic data');

    await expect(readFile(target.path)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('removes files when processing fails', async () => {
    const target = await storage.createUploadTarget();
    const failure = new Error('synthetic processing failure');

    await expect(
      storage.processAndDelete(target.storageKey, async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);

    await expect(readFile(target.path)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects keys that could escape the temporary directory', () => {
    expect(() => storage.resolvePath('..\\outside.upload')).toThrow(
      'Customer import storage key is invalid',
    );
  });

  it('confirms that the configured directory is writable', async () => {
    await expect(storage.isWritable()).resolves.toBe(true);
  });
});
