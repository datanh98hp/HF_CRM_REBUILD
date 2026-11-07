import { BadRequestException } from '@nestjs/common';

/** Canonical CRM format for Vietnamese numbers: ten digits starting with 0. */
export function normalizeVietnamesePhone(value: string): string {
  const compact = value.trim().replace(/[\s().-]/g, '');
  let normalized: string;

  if (compact.startsWith('+84')) normalized = `0${compact.slice(3)}`;
  else if (compact.startsWith('0084')) normalized = `0${compact.slice(4)}`;
  else if (/^84\d+$/.test(compact)) normalized = `0${compact.slice(2)}`;
  else normalized = compact;

  if (!/^0[1-9]\d{8}$/.test(normalized)) {
    throw new BadRequestException({ code: 'INVALID_VIETNAMESE_PHONE', message: 'Số điện thoại phải gồm 10 chữ số, bắt đầu bằng 0 và chữ số thứ hai phải khác 0' });
  }
  return normalized;
}

export function normalizeVietnamesePhoneSearch(value: string): string {
  const compact = value.trim().replace(/[\s().-]/g, '');
  try {
    return normalizeVietnamesePhone(compact);
  } catch {
    return compact.replace(/\D/g, '');
  }
}
