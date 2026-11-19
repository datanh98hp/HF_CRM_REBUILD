import ExcelJS from 'exceljs';
import { createDeflateRaw } from 'node:zlib';
import { Readable } from 'node:stream';
import { parseCustomerImportFile } from './customer-import-parser.js';

async function createZipWithSpoofedUncompressedSize(): Promise<Buffer> {
  const fileName = Buffer.from('xl/worksheets/sheet1.xml');
  const deflater = createDeflateRaw();
  const compressedChunks: Buffer[] = [];
  const collectCompressed = (async () => {
    for await (const chunk of deflater) {
      compressedChunks.push(Buffer.from(chunk));
    }
  })();
  const source = Readable.from((function* () {
    const chunk = Buffer.alloc(64 * 1024, 0x41);
    let remaining = 101 * 1024 * 1024;
    while (remaining > 0) {
      const length = Math.min(chunk.length, remaining);
      yield chunk.subarray(0, length);
      remaining -= length;
    }
  })());
  source.pipe(deflater);
  await collectCompressed;
  const compressed = Buffer.concat(compressedChunks);

  const localHeader = Buffer.alloc(30 + fileName.length);
  localHeader.writeUInt32LE(0x04034b50, 0);
  localHeader.writeUInt16LE(20, 4);
  localHeader.writeUInt16LE(8, 8);
  localHeader.writeUInt32LE(compressed.length, 18);
  localHeader.writeUInt32LE(0, 22);
  localHeader.writeUInt16LE(fileName.length, 26);
  fileName.copy(localHeader, 30);

  const centralHeader = Buffer.alloc(46 + fileName.length);
  centralHeader.writeUInt32LE(0x02014b50, 0);
  centralHeader.writeUInt16LE(20, 4);
  centralHeader.writeUInt16LE(20, 6);
  centralHeader.writeUInt16LE(8, 10);
  centralHeader.writeUInt32LE(compressed.length, 20);
  centralHeader.writeUInt32LE(0, 24);
  centralHeader.writeUInt16LE(fileName.length, 28);
  fileName.copy(centralHeader, 46);

  const centralOffset = localHeader.length + compressed.length;
  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(0x06054b50, 0);
  endRecord.writeUInt16LE(1, 8);
  endRecord.writeUInt16LE(1, 10);
  endRecord.writeUInt32LE(centralHeader.length, 12);
  endRecord.writeUInt32LE(centralOffset, 16);

  return Buffer.concat([localHeader, compressed, centralHeader, endRecord]);
}

describe('parseCustomerImportFile', () => {
  it('parses UTF-8 CSV with BOM, quoted commas, and optional values', async () => {
    const data = Buffer.from(
      '\uFEFFHọ tên,Số điện thoại,Email,Ngày sinh\r\n"Nguyễn Thị Lan Anh, Jr.",0912345678,,1992-03-14\r\n',
      'utf8',
    );

    await expect(parseCustomerImportFile(data, 'csv')).resolves.toMatchObject([
      {
        fullName: 'Nguyễn Thị Lan Anh, Jr.',
        normalizedName: 'nguyen thi lan anh jr',
        phone: '0912345678',
        email: null,
        dateOfBirth: new Date('1992-03-14T00:00:00.000Z'),
      },
    ]);
  });

  it('rejects malformed, invalid, and over-limit CSV data', async () => {
    await expect(
      parseCustomerImportFile(Buffer.from('Họ tên,Số điện thoại\n"broken,0912345678'), 'csv'),
    ).rejects.toMatchObject({ code: 'INVALID_CSV' });
    await expect(
      parseCustomerImportFile(Buffer.from('Họ tên,Số điện thoại\nNguyễn An,123'), 'csv'),
    ).rejects.toMatchObject({ code: 'INVALID_IMPORT_DATA' });
    await expect(
      parseCustomerImportFile(Buffer.alloc(20 * 1024 * 1024 + 1), 'csv'),
    ).rejects.toMatchObject({ code: 'FILE_SIZE_LIMIT_EXCEEDED' });
  });

  it('reads the first visible XLSX sheet and rejects formula cells', async () => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Khach hang');
    worksheet.addRow(['Họ tên', 'Số điện thoại', 'Email', 'Ngày sinh']);
    worksheet.addRow(['Nguyễn Thị Lan Anh', '0912345678', '', '1992-03-14']);
    const data = Buffer.from(await workbook.xlsx.writeBuffer());

    await expect(parseCustomerImportFile(data, 'xlsx')).resolves.toHaveLength(1);

    worksheet.getCell('A2').value = { formula: 'CONCAT("Nguyễn"," An")' };
    const formulaWorkbook = Buffer.from(await workbook.xlsx.writeBuffer());
    await expect(parseCustomerImportFile(formulaWorkbook, 'xlsx')).rejects.toMatchObject({
      code: 'UNSUPPORTED_XLSX_FEATURE',
    });
  });

  it('enforces the actual expanded XLSX size when ZIP metadata understates it', async () => {
    const data = await createZipWithSpoofedUncompressedSize();

    await expect(parseCustomerImportFile(data, 'xlsx')).rejects.toMatchObject({
      code: 'XLSX_SIZE_LIMIT_EXCEEDED',
    });
  });
});
