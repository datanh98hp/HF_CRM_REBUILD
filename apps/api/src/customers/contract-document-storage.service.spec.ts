import { mkdtemp, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ServiceUnavailableException } from '@nestjs/common';
import { ContractDocumentStorageService } from './contract-document-storage.service.js';

describe('ContractDocumentStorageService', () => {
  const testDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const envNames = [
    'NODE_ENV',
    'CONTRACT_DOCUMENT_DIRECTORY',
    'MINIO_ENDPOINT',
    'MINIO_ACCESS_KEY',
    'MINIO_SECRET_KEY',
    'MINIO_BUCKET',
    'MINIO_REGION',
    'MINIO_PREFIX',
  ];
  const originalEnv = new Map(envNames.map((name) => [name, process.env[name]]));
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(testDirectory, '.contract-storage-test-'));
    process.env.NODE_ENV = 'test';
    process.env.CONTRACT_DOCUMENT_DIRECTORY = directory;
    for (const name of envNames.filter((key) => key.startsWith('MINIO_'))) delete process.env[name];
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
    for (const name of envNames) {
      const value = originalEnv.get(name);
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it('uses the existing local storage when MinIO settings are absent', async () => {
    const storage = new ContractDocumentStorageService();
    const storageKey = '123e4567-e89b-12d3-a456-426614174000.pdf';
    await storage.put(storageKey, Buffer.from('local file'), 'application/pdf');

    const stream = await storage.read(storageKey);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    expect(Buffer.concat(chunks).toString()).toBe('local file');

    await storage.remove(storageKey);
    await expect(stat(join(directory, storageKey))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects partial MinIO configuration instead of silently falling back to local disk', () => {
    process.env.MINIO_ENDPOINT = 'http://minio:9000';

    expect(() => new ContractDocumentStorageService()).toThrow(/must be configured together/);
  });

  it('blocks production writes at the storage boundary until malware scanning is implemented', async () => {
    process.env.NODE_ENV = 'production';
    const storage = new ContractDocumentStorageService();
    const storageKey = '123e4567-e89b-12d3-a456-426614174000.pdf';

    expect(() => storage.assertUploadsAvailable()).toThrow(ServiceUnavailableException);
    await expect(storage.put(storageKey, Buffer.from('blocked'), 'application/pdf'))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(stat(join(directory, storageKey))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
