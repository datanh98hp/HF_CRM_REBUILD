import { InternalServerErrorException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createReadStream } from 'node:fs';
import { mkdir, stat, unlink, writeFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { join, resolve } from 'node:path';

const STORAGE_KEY_PATTERN = /^[\da-f-]{36}\.(docx|jpeg|jpg|pdf|png)$/;
const DEFAULT_DOCUMENT_DIRECTORY = resolve('/tmp/contracts');

function isMissingObject(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'name' in error &&
    (error.name === 'NoSuchKey' || error.name === 'NotFound');
}

@Injectable()
export class ContractDocumentStorageService {
  private readonly client: S3Client | null;
  private readonly bucket: string | null;
  private readonly prefix: string;
  private readonly directory: string;

  constructor() {
    const endpoint = process.env.MINIO_ENDPOINT?.trim() ?? '';
    const accessKey = process.env.MINIO_ACCESS_KEY?.trim() ?? '';
    const secretKey = process.env.MINIO_SECRET_KEY ?? '';
    const bucket = process.env.MINIO_BUCKET?.trim() ?? '';
    const configured = [endpoint, accessKey, secretKey, bucket].filter(Boolean).length;

    if (configured !== 0 && configured !== 4) {
      throw new Error('MINIO_ENDPOINT, MINIO_ACCESS_KEY, MINIO_SECRET_KEY, and MINIO_BUCKET must be configured together');
    }

    if (configured === 4) {
      let endpointUrl: URL;
      try {
        endpointUrl = new URL(endpoint);
      } catch {
        throw new Error('MINIO_ENDPOINT must be a valid HTTP or HTTPS URL');
      }
      if (!['http:', 'https:'].includes(endpointUrl.protocol) || endpointUrl.username || endpointUrl.password) {
        throw new Error('MINIO_ENDPOINT must be a credential-free HTTP or HTTPS URL');
      }

      this.client = new S3Client({
        endpoint: endpointUrl.toString(),
        region: process.env.MINIO_REGION?.trim() || 'us-east-1',
        forcePathStyle: true,
        credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
      });
      this.bucket = bucket;
      this.prefix = (process.env.MINIO_PREFIX?.trim() || 'contracts').replace(/^\/+|\/+$/g, '');
      if (!/^[\w/-]+$/.test(this.prefix)) throw new Error('MINIO_PREFIX contains unsupported characters');
    } else {
      this.client = null;
      this.bucket = null;
      this.prefix = '';
    }

    this.directory = process.env.CONTRACT_DOCUMENT_DIRECTORY
      ? resolve(process.env.CONTRACT_DOCUMENT_DIRECTORY)
      : DEFAULT_DOCUMENT_DIRECTORY;
  }

  assertUploadsAvailable(): void {
    if (process.env.NODE_ENV === 'production') {
      throw new ServiceUnavailableException({ code: 'LOAN_CONTRACT_DOCUMENT_UPLOADS_NOT_READY' });
    }
  }

  async put(storageKey: string, data: Buffer, mimeType: string): Promise<void> {
    this.assertUploadsAvailable();
    this.assertStorageKey(storageKey);
    if (this.client && this.bucket) {
      await this.client.send(new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.objectKey(storageKey),
        Body: data,
        ContentLength: data.length,
        ContentType: mimeType,
      }));
      return;
    }

    await mkdir(this.directory, { recursive: true });
    await writeFile(join(this.directory, storageKey), data, { flag: 'wx' });
  }

  async remove(storageKey: string): Promise<void> {
    this.assertStorageKey(storageKey);
    if (this.client && this.bucket) {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: this.objectKey(storageKey) }));
      return;
    }
    await unlink(join(this.directory, storageKey));
  }

  async read(storageKey: string): Promise<Readable> {
    this.assertStorageKey(storageKey);
    if (this.client && this.bucket) {
      try {
        const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: this.objectKey(storageKey) }));
        if (result.Body instanceof Readable) return result.Body;
        throw new InternalServerErrorException({ code: 'LOAN_CONTRACT_DOCUMENT_FILE_MISSING' });
      } catch (error) {
        if (isMissingObject(error)) {
          throw new InternalServerErrorException({ code: 'LOAN_CONTRACT_DOCUMENT_FILE_MISSING' });
        }
        throw error;
      }
    }

    const filePath = join(this.directory, storageKey);
    try {
      if (!(await stat(filePath)).isFile()) {
        throw new InternalServerErrorException({ code: 'LOAN_CONTRACT_DOCUMENT_FILE_MISSING' });
      }
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
        throw new InternalServerErrorException({ code: 'LOAN_CONTRACT_DOCUMENT_FILE_MISSING' });
      }
      throw error;
    }
    return createReadStream(filePath);
  }

  private objectKey(storageKey: string): string {
    return `${this.prefix}/${storageKey}`;
  }

  private assertStorageKey(storageKey: string): void {
    if (!STORAGE_KEY_PATTERN.test(storageKey)) {
      throw new InternalServerErrorException({ code: 'LOAN_CONTRACT_DOCUMENT_STORAGE_KEY_INVALID' });
    }
  }
}
