import ExcelJS from 'exceljs';
import { Readable } from 'node:stream';
import { Parse } from 'unzipper';
import { normalizeCustomerEmail, normalizeCustomerName } from '../customers/customer-normalization.js';
import { normalizeVietnamesePhone } from '../customers/phone-normalizer.js';

export const CUSTOMER_IMPORT_MAX_BYTES = 20 * 1024 * 1024;
export const CUSTOMER_IMPORT_MAX_ROWS = 10_000;
const MAX_XLSX_SHEETS = 10;
const MAX_XLSX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;
const MAX_XLSX_ENTRIES = 1_000;
const MAX_COLUMNS = 100;
const MAX_CELL_CHARACTERS = 4_096;

export type CustomerImportFileFormat = 'csv' | 'xlsx';

export type CustomerImportValidationErrorCode =
  | 'FULL_NAME_REQUIRED'
  | 'INVALID_FULL_NAME'
  | 'PHONE_REQUIRED'
  | 'INVALID_PHONE'
  | 'INVALID_EMAIL'
  | 'INVALID_DATE_OF_BIRTH';

export interface CustomerImportRecord {
  rowNumber: number;
  fullName: string;
  normalizedName: string;
  phone: string;
  phoneNormalized: string;
  email: string | null;
  emailNormalized: string | null;
  dateOfBirth: Date | null;
}

export interface CustomerImportRowFailure {
  rowNumber: number;
  errorCodes: CustomerImportValidationErrorCode[];
}

export interface CustomerImportParseResult {
  records: CustomerImportRecord[];
  failures: CustomerImportRowFailure[];
  totalRows: number;
}

interface SourceRow {
  rowNumber: number;
  values: string[];
}

export class CustomerImportFileError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'CustomerImportFileError';
  }
}

function fail(code: string): never {
  throw new CustomerImportFileError(code);
}

function parseCsv(text: string): SourceRow[] {
  const rows: SourceRow[] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let quoteClosed = false;
  let physicalLineNumber = 1;
  let rowStartLine = 1;

  const pushField = () => {
    row.push(field);
    field = '';
    quoteClosed = false;
  };
  const pushRow = () => {
    pushField();
    rows.push({ rowNumber: rowStartLine, values: row });
    row = [];
    if (rows.length > CUSTOMER_IMPORT_MAX_ROWS + 1) fail('ROW_LIMIT_EXCEEDED');
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
          quoteClosed = true;
        }
      } else {
        field += character;
        if (character === '\n') physicalLineNumber += 1;
      }
    } else if (quoteClosed) {
      if (character === ',') pushField();
      else if (character === '\n') {
        pushRow();
        physicalLineNumber += 1;
        rowStartLine = physicalLineNumber;
      }
      else if (character === '\r' && text[index + 1] === '\n') {
        index += 1;
        pushRow();
        physicalLineNumber += 1;
        rowStartLine = physicalLineNumber;
      } else if (character !== ' ' && character !== '\t') {
        fail('INVALID_CSV');
      }
    } else if (character === '"') {
      if (field.length !== 0) fail('INVALID_CSV');
      quoted = true;
    } else if (character === ',') {
      pushField();
    } else if (character === '\n') {
      pushRow();
      physicalLineNumber += 1;
      rowStartLine = physicalLineNumber;
    } else if (character === '\r' && text[index + 1] === '\n') {
      index += 1;
      pushRow();
      physicalLineNumber += 1;
      rowStartLine = physicalLineNumber;
    } else {
      field += character;
    }

    if (field.length > MAX_CELL_CHARACTERS) fail('CELL_LIMIT_EXCEEDED');
  }

  if (quoted) fail('INVALID_CSV');
  if (field.length > 0 || row.length > 0 || quoteClosed) pushRow();
  return rows;
}

function fieldValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  fail('INVALID_WORKBOOK_CELL');
}

function fieldIndexes(header: string[]): Map<string, number> {
  if (header.length > MAX_COLUMNS) fail('COLUMN_LIMIT_EXCEEDED');
  const aliases = new Map<string, string>([
    ['ho ten', 'fullName'],
    ['fullname', 'fullName'],
    ['full name', 'fullName'],
    ['name', 'fullName'],
    ['so dien thoai', 'phone'],
    ['sdt', 'phone'],
    ['phone', 'phone'],
    ['phone number', 'phone'],
    ['mobile', 'phone'],
    ['email', 'email'],
    ['thu dien tu', 'email'],
    ['ngay sinh', 'dateOfBirth'],
    ['date of birth', 'dateOfBirth'],
    ['dateofbirth', 'dateOfBirth'],
    ['dob', 'dateOfBirth'],
  ]);
  const indexes = new Map<string, number>();
  header.forEach((value, index) => {
    const key = normalizeCustomerName(value);
    const field = aliases.get(key);
    if (!field) return;
    if (indexes.has(field)) fail('AMBIGUOUS_COLUMNS');
    indexes.set(field, index);
  });
  if (!indexes.has('fullName') || !indexes.has('phone')) fail('MISSING_REQUIRED_COLUMNS');
  return indexes;
}

function parseDate(value: string): Date | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) fail('INVALID_IMPORT_DATA');
  const [year, month, day] = trimmed.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day ||
    date.getTime() > Date.now()
  ) fail('INVALID_IMPORT_DATA');
  return date;
}

function toRecords(rows: SourceRow[]): CustomerImportParseResult {
  if (!rows.length) fail('EMPTY_IMPORT_FILE');
  const indexes = fieldIndexes(rows[0].values);
  const records: CustomerImportRecord[] = [];
  const failures: CustomerImportRowFailure[] = [];

  for (const sourceRow of rows.slice(1)) {
    const row = sourceRow.values;
    if (row.every((value) => value.trim() === '')) continue;
    const fullName = (row[indexes.get('fullName')!] ?? '').trim();
    const errorCodes: CustomerImportValidationErrorCode[] = [];
    if (!fullName) errorCodes.push('FULL_NAME_REQUIRED');
    else if (fullName.length < 2 || fullName.length > 160) errorCodes.push('INVALID_FULL_NAME');

    const phone = (row[indexes.get('phone')!] ?? '').trim();
    let phoneNormalized = '';
    if (!phone) {
      errorCodes.push('PHONE_REQUIRED');
    } else {
      try {
        phoneNormalized = normalizeVietnamesePhone(phone);
      } catch {
        errorCodes.push('INVALID_PHONE');
      }
    }

    let email: string | null;
    try {
      email = normalizeCustomerEmail(row[indexes.get('email') ?? -1] ?? '');
    } catch {
      email = null;
      errorCodes.push('INVALID_EMAIL');
    }
    let dateOfBirth: Date | null = null;
    try {
      dateOfBirth = parseDate(row[indexes.get('dateOfBirth') ?? -1] ?? '');
    } catch (error) {
      if (!(error instanceof CustomerImportFileError) || error.code !== 'INVALID_IMPORT_DATA') throw error;
      errorCodes.push('INVALID_DATE_OF_BIRTH');
    }

    if (errorCodes.length) {
      failures.push({ rowNumber: sourceRow.rowNumber, errorCodes });
      continue;
    }

    records.push({
      rowNumber: sourceRow.rowNumber,
      fullName,
      normalizedName: normalizeCustomerName(fullName),
      phone: phoneNormalized,
      phoneNormalized,
      email,
      emailNormalized: email,
      dateOfBirth,
    });
    if (records.length > CUSTOMER_IMPORT_MAX_ROWS) fail('ROW_LIMIT_EXCEEDED');
  }

  const totalRows = records.length + failures.length;
  if (!totalRows) fail('EMPTY_IMPORT_FILE');
  return { records, failures, totalRows };
}

function inspectXlsxArchive(buffer: Buffer): void {
  const minimumEocdOffset = Math.max(0, buffer.length - 22 - 0xffff);
  let eocdOffset = -1;
  for (let offset = buffer.length - 22; offset >= minimumEocdOffset; offset -= 1) {
    if (
      buffer.readUInt32LE(offset) === 0x06054b50 &&
      offset + 22 + buffer.readUInt16LE(offset + 20) === buffer.length
    ) {
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset < 0) fail('INVALID_XLSX');

  const diskNumber = buffer.readUInt16LE(eocdOffset + 4);
  const centralDirectoryDisk = buffer.readUInt16LE(eocdOffset + 6);
  const entriesOnDisk = buffer.readUInt16LE(eocdOffset + 8);
  const entries = buffer.readUInt16LE(eocdOffset + 10);
  const centralDirectoryBytes = buffer.readUInt32LE(eocdOffset + 12);
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
  if (
    diskNumber !== 0 ||
    centralDirectoryDisk !== 0 ||
    entriesOnDisk !== entries ||
    entries === 0xffff ||
    centralDirectoryBytes === 0xffffffff ||
    centralDirectoryOffset === 0xffffffff ||
    entries > MAX_XLSX_ENTRIES ||
    centralDirectoryOffset + centralDirectoryBytes > eocdOffset
  ) fail('INVALID_XLSX_ARCHIVE');

  let offset = centralDirectoryOffset;
  let uncompressedBytes = 0;
  for (let index = 0; index < entries; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) fail('INVALID_XLSX_ARCHIVE');
    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameBytes = buffer.readUInt16LE(offset + 28);
    const extraBytes = buffer.readUInt16LE(offset + 30);
    const commentBytes = buffer.readUInt16LE(offset + 32);
    const end = offset + 46 + nameBytes + extraBytes + commentBytes;
    if (
      end > centralDirectoryOffset + centralDirectoryBytes ||
      (flags & 1) !== 0 ||
      (method !== 0 && method !== 8) ||
      uncompressedSize === 0xffffffff
    ) fail('INVALID_XLSX_ARCHIVE');

    uncompressedBytes += uncompressedSize;
    if (uncompressedBytes > MAX_XLSX_UNCOMPRESSED_BYTES) fail('XLSX_SIZE_LIMIT_EXCEEDED');

    const entryName = buffer.subarray(offset + 46, offset + 46 + nameBytes).toString('utf8')
      .replace(/\\/g, '/')
      .toLowerCase();
    if (
      entryName.split('/').includes('..') ||
      entryName.includes('vbaproject.bin') ||
      entryName.startsWith('xl/externallinks/')
    ) fail('UNSUPPORTED_XLSX_FEATURE');

    offset = end;
  }
  if (offset !== centralDirectoryOffset + centralDirectoryBytes) fail('INVALID_XLSX_ARCHIVE');
}

async function inspectXlsxExpandedSize(buffer: Buffer): Promise<void> {
  const parser = Parse({ forceStream: true });
  Readable.from([buffer]).pipe(parser);
  let entries = 0;
  let expandedBytes = 0;

  try {
    for await (const entry of parser) {
      entries += 1;
      const path = entry.path.replace(/\\/g, '/').toLowerCase();
      if (
        entries > MAX_XLSX_ENTRIES ||
        path.split('/').includes('..') ||
        path.includes('vbaproject.bin') ||
        path.startsWith('xl/externallinks/')
      ) fail('UNSUPPORTED_XLSX_FEATURE');

      for await (const chunk of entry) {
        if (!Buffer.isBuffer(chunk) && typeof chunk !== 'string' && !(chunk instanceof Uint8Array)) {
          fail('INVALID_XLSX_ARCHIVE');
        }
        expandedBytes += typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.byteLength;
        if (expandedBytes > MAX_XLSX_UNCOMPRESSED_BYTES) fail('XLSX_SIZE_LIMIT_EXCEEDED');
      }
    }
  } catch (error) {
    parser.destroy();
    if (error instanceof CustomerImportFileError) throw error;
    fail('INVALID_XLSX_ARCHIVE');
  }
}

async function xlsxRows(buffer: Buffer): Promise<SourceRow[]> {
  inspectXlsxArchive(buffer);
  await inspectXlsxExpandedSize(buffer);
  let workbook: ExcelJS.Workbook;
  try {
    workbook = new ExcelJS.Workbook();
    await workbook.xlsx.read(Readable.from([buffer]));
  } catch {
    fail('INVALID_XLSX');
  }

  const sheets = workbook.worksheets;
  if (!sheets.length || sheets.length > MAX_XLSX_SHEETS) fail('XLSX_SHEET_LIMIT_EXCEEDED');
  const sheet = sheets.find((item) => item.state === 'visible');
  if (!sheet || sheet.rowCount > CUSTOMER_IMPORT_MAX_ROWS + 1) fail('ROW_LIMIT_EXCEEDED');

  const rows: SourceRow[] = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (row.cellCount > MAX_COLUMNS) fail('COLUMN_LIMIT_EXCEEDED');
    const values: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell, column) => {
      const value = cell.value;
      if (
        cell.hyperlink ||
        (typeof value === 'object' && value !== null && ('formula' in value || 'sharedFormula' in value))
      ) fail('UNSUPPORTED_XLSX_FEATURE');
      values[column - 1] = fieldValue(value);
    });
    rows.push({ rowNumber, values: values.map((value) => value ?? '') });
    if (rows.length > CUSTOMER_IMPORT_MAX_ROWS + 1) fail('ROW_LIMIT_EXCEEDED');
  });
  return rows;
}

export async function parseCustomerImportFile(
  buffer: Buffer,
  format: CustomerImportFileFormat,
): Promise<CustomerImportParseResult> {
  if (buffer.length === 0) fail('EMPTY_IMPORT_FILE');
  if (buffer.length > CUSTOMER_IMPORT_MAX_BYTES) fail('FILE_SIZE_LIMIT_EXCEEDED');

  if (format === 'csv') {
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^\uFEFF/, '');
    } catch {
      fail('INVALID_CSV_ENCODING');
    }
    return toRecords(parseCsv(text));
  }

  if (format !== 'xlsx' || buffer.subarray(0, 4).toString('hex') !== '504b0304') {
    fail('INVALID_FILE_SIGNATURE');
  }
  return toRecords(await xlsxRows(buffer));
}
