import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { chmod, mkdir, open, unlink, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';

const STORAGE_KEY_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.upload$/i;

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error &&
    typeof error.code === 'string'
    ? error.code
    : undefined;
}

@Injectable()
export class CustomerImportTempStorageService {
  private readonly directory: string;

  constructor(directory: string) {
    this.directory = resolve(directory);
  }

  getDirectory(): string {
    return this.directory;
  }

  async createUploadTarget(): Promise<{ storageKey: string; path: string }> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    if (process.platform !== 'win32') {
      await chmod(this.directory, 0o700);
    }

    const storageKey = `${randomUUID()}.upload`;
    const path = this.resolvePath(storageKey);
    const handle = await open(path, 'wx', 0o600);
    await handle.close();

    return { storageKey, path };
  }

  async writeUpload(buffer: Buffer): Promise<{ storageKey: string; path: string }> {
    const target = await this.createUploadTarget();
    try {
      await writeFile(target.path, buffer, { flag: 'w', mode: 0o600 });
      return target;
    } catch (writeError) {
      try {
        await this.remove(target.storageKey);
      } catch (cleanupError) {
        throw new AggregateError(
          [writeError, cleanupError],
          'Customer import upload failed and its temporary file could not be removed',
        );
      }
      throw writeError;
    }
  }

  async isWritable(): Promise<boolean> {
    let target: { storageKey: string; path: string } | undefined;
    try {
      target = await this.createUploadTarget();
      return true;
    } catch (error) {
      if (['EACCES', 'EPERM', 'EROFS', 'ENOSPC'].includes(errorCode(error) ?? '')) {
        return false;
      }
      throw error;
    } finally {
      if (target) await this.remove(target.storageKey);
    }
  }

  async remove(storageKey: string): Promise<void> {
    try {
      await unlink(this.resolvePath(storageKey));
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') throw error;
    }
  }

  async processAndDelete<T>(
    storageKey: string,
    processFile: (path: string) => Promise<T>,
  ): Promise<T> {
    const path = this.resolvePath(storageKey);
    let processingFailed = false;
    let processingError: unknown;
    try {
      return await processFile(path);
    } catch (error) {
      processingFailed = true;
      processingError = error;
      throw error;
    } finally {
      try {
        await this.remove(storageKey);
      } catch (cleanupError) {
        if (processingFailed) {
          throw new AggregateError(
            [processingError, cleanupError],
            'Customer import failed and its temporary file could not be removed',
          );
        }
        throw cleanupError;
      }
    }
  }

  resolvePath(storageKey: string): string {
    if (!STORAGE_KEY_PATTERN.test(storageKey)) {
      throw new Error('Customer import storage key is invalid');
    }

    const path = resolve(this.directory, storageKey);
    const relativePath = relative(this.directory, path);
    if (
      !relativePath ||
      relativePath.startsWith(`..${sep}`) ||
      relativePath === '..' ||
      isAbsolute(relativePath)
    ) {
      throw new Error('Customer import storage key is outside its temporary directory');
    }
    return path;
  }
}
