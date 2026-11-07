import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from '@jest/globals';
import { normalizeVietnamesePhone, normalizeVietnamesePhoneSearch } from './phone-normalizer.js';

describe('Vietnamese phone normalization', () => {
  it.each([
    ['0912 345 678', '0912345678'],
    ['+84 912-345-678', '0912345678'],
    ['0084 (912) 345.678', '0912345678'],
    ['84 912 345 678', '0912345678'],
  ])('normalizes %s to local canonical form', (input, expected) => {
    expect(normalizeVietnamesePhone(input)).toBe(expected);
  });

  it.each(['912345678', '091234567', '0012345678', '00912345678', '08491234567', '09123456789', '+840912345678', '+84 012345678'])('rejects noncanonical or malformed input %s', (input) => {
    expect(() => normalizeVietnamesePhone(input)).toThrow(BadRequestException);
  });

  it('normalizes international search input to the stored local number', () => {
    expect(normalizeVietnamesePhoneSearch('+84 912 345 678')).toBe('0912345678');
    expect(normalizeVietnamesePhoneSearch('customer')).toBe('');
  });
});
