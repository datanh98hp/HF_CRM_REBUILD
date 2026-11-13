import 'reflect-metadata';
import { describe, expect, it } from '@jest/globals';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ChangePasswordDto } from './auth.dto.js';

describe('ChangePasswordDto', () => {
  it('accepts an existing password at the minimum login length and a 12-character new password', async () => {
    const dto = plainToInstance(ChangePasswordDto, {
      currentPassword: '12345678',
      newPassword: '123456789012',
    });

    await expect(validate(dto)).resolves.toEqual([]);
  });

  it('rejects a new password shorter than 12 characters', async () => {
    const dto = plainToInstance(ChangePasswordDto, {
      currentPassword: '12345678',
      newPassword: '12345678901',
    });

    expect(await validate(dto)).not.toHaveLength(0);
  });
});
