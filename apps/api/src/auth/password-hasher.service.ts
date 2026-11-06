import { Injectable } from '@nestjs/common';
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';

const keyLength = 64;
const workFactor = 32_768;
const maxMemory = 128 * 1024 * 1024;

function scrypt(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keyLength, {
      N: workFactor,
      r: 8,
      p: 1,
      maxmem: maxMemory,
    }, (error, key) => (error ? reject(error) : resolve(key as Buffer)));
  });
}

@Injectable()
export class PasswordHasherService {
  async hash(password: string): Promise<string> {
    const salt = randomBytes(16);
    const key = await scrypt(password, salt);
    return `scrypt$${workFactor}$8$1$${salt.toString('base64url')}$${key.toString('base64url')}`;
  }

  async verify(password: string, encoded: string): Promise<boolean> {
    const [algorithm, n, r, p, saltValue, keyValue, extra] = encoded.split('$');
    if (
      algorithm !== 'scrypt' || n !== String(workFactor) || r !== '8' || p !== '1' ||
      !saltValue || !keyValue || extra !== undefined
    ) return false;

    try {
      const salt = Buffer.from(saltValue, 'base64url');
      const expected = Buffer.from(keyValue, 'base64url');
      if (salt.length !== 16 || expected.length !== keyLength) return false;
      const actual = await scrypt(password, salt);
      return timingSafeEqual(actual, expected);
    } catch {
      return false;
    }
  }
}
