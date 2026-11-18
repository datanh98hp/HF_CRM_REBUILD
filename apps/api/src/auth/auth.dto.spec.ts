import 'reflect-metadata';
import { describe, expect, it } from '@jest/globals';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ChangePasswordDto } from './auth.dto.js';

describe('ChangePasswordDto', () => {
  it('accepts current and new passwords at the minimum length of 8 characters', async () => {
    const dto = plainToInstance(ChangePasswordDto, {
      currentPassword: '12345678',
      newPassword: 'abcdefgh',
    });

    await expect(validate(dto)).resolves.toEqual([]);
  });

  it('rejects a new password shorter than 8 characters', async () => {
    const dto = plainToInstance(ChangePasswordDto, {
      currentPassword: '12345678',
      newPassword: 'abcdefg',
    });

    expect(await validate(dto)).not.toHaveLength(0);
  });
});
