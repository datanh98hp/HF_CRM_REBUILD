import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { Readable, Writable } from 'node:stream';
import { describe, it } from 'node:test';
import { decryptBackupStream, encryptBackupStream } from './backup-crypto.mjs';

async function collect(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function encrypt(payload, key) {
  const chunks = [];
  const destination = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.from(chunk));
      callback();
    },
  });
  await encryptBackupStream(Readable.from([payload.subarray(0, 7), payload.subarray(7)]), destination, key);
  return Buffer.concat(chunks);
}

describe('encrypted PostgreSQL backup stream', () => {
  it('round-trips an encrypted stream', async () => {
    const key = randomBytes(32);
    const payload = randomBytes(1024);
    const encrypted = await encrypt(payload, key);

    assert.deepEqual(await collect(decryptBackupStream(Readable.from([
      encrypted.subarray(0, 9),
      encrypted.subarray(9, 23),
      encrypted.subarray(23),
    ]), key)), payload);
  });

  it('rejects tampered ciphertext', async () => {
    const key = randomBytes(32);
    const encrypted = await encrypt(Buffer.from('database archive'), key);
    encrypted[encrypted.length - 1] ^= 0xff;

    await assert.rejects(collect(decryptBackupStream(Readable.from([encrypted]), key)));
  });

  it('rejects ciphertext encrypted with a different key', async () => {
    const encrypted = await encrypt(Buffer.from('synthetic database archive'), randomBytes(32));

    await assert.rejects(collect(decryptBackupStream(Readable.from([encrypted]), randomBytes(32))));
  });
});
