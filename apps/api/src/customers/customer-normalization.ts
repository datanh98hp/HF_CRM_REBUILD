import { BadRequestException } from '@nestjs/common';

export function normalizeCustomerName(value: string): string {
  return value.trim().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .toLowerCase();
}

export function normalizeCustomerEmail(value?: string | null): string | null {
  if (value === undefined || value === null || value.trim() === '') return null;
  const email = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new BadRequestException({ code: 'INVALID_EMAIL' });
  }
  return email;
}
