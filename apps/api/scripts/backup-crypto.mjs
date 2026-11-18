import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { once } from 'node:events';

const MAGIC = Buffer.from('HFCRM01\n');
const IV_BYTES = 12;
const TAG_BYTES = 16;

export function parseBackupKey(value) {
  const key = Buffer.from(value ?? '', 'base64');
  if (key.length !== 32) throw new Error('BACKUP_ENCRYPTION_KEY must be a base64-encoded 32-byte key');
  return key;
}

export async function encryptBackupStream(source, destination, key) {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  if (!destination.write(Buffer.concat([MAGIC, iv]))) await once(destination, 'drain');

  const appendTag = new Transform({
    transform(chunk, _encoding, callback) {
      callback(null, chunk);
    },
    flush(callback) {
      this.push(cipher.getAuthTag());
      callback();
    },
  });
  await pipeline(source, cipher, appendTag, destination);
}

export function decryptBackupStream(source, key) {
  async function* decryptChunks() {
    let header = Buffer.alloc(0);
    let tail = Buffer.alloc(0);
    let decipher;

    for await (const chunk of source) {
      let data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (!decipher) {
        header = Buffer.concat([header, data]);
        if (header.length < MAGIC.length + IV_BYTES) continue;
        if (!header.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('Backup file header is invalid');
        decipher = createDecipheriv('aes-256-gcm', key, header.subarray(MAGIC.length, MAGIC.length + IV_BYTES));
        data = header.subarray(MAGIC.length + IV_BYTES);
        header = Buffer.alloc(0);
      }

      const combined = Buffer.concat([tail, data]);
      if (combined.length > TAG_BYTES) {
        const ciphertextEnd = combined.length - TAG_BYTES;
        yield decipher.update(combined.subarray(0, ciphertextEnd));
        tail = combined.subarray(ciphertextEnd);
      } else {
        tail = combined;
      }
    }

    if (!decipher || tail.length !== TAG_BYTES) throw new Error('Backup file is incomplete');
    decipher.setAuthTag(tail);
    yield decipher.final();
  }

  return Readable.from(decryptChunks());
}
