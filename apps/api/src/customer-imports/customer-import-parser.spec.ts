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
  it('parses the customer template CSV with an ignored sequence column', async () => {
    const data = Buffer.from(
      '\uFEFFTT,Họ tên,Số điện thoại,Email,Ngày sinh\r\n1,"Nguyễn Thị Lan Anh, Jr.",0912345678,,1992-03-14\r\n',
      'utf8',
    );

    await expect(parseCustomerImportFile(data, 'csv')).resolves.toMatchObject({
      records: [
        {
          rowNumber: 2,
          fullName: 'Nguyễn Thị Lan Anh, Jr.',
          normalizedName: 'nguyen thi lan anh jr',
          phone: '0912345678',
          email: null,
          dateOfBirth: new Date('1992-03-14T00:00:00.000Z'),
        },
      ],
      failures: [],
      totalRows: 1,
    });
  });

  it('continues past invalid rows and reports their file line numbers', async () => {
    const data = Buffer.from(
      'Họ tên,Số điện thoại,Email,Ngày sinh\n' +
      '"Nguyễn\nThị Lan Anh",0912345678,,1992-03-14\n' +
      ',123,invalid-email,2030-01-01\n' +
      'Trần Quốc Bảo,,,\n',
      'utf8',
    );

    await expect(parseCustomerImportFile(data, 'csv')).resolves.toMatchObject({
      records: [{ rowNumber: 2, fullName: 'Nguyễn\nThị Lan Anh', phone: '0912345678' }],
      failures: [
        {
          rowNumber: 4,
          errorCodes: [
            'FULL_NAME_REQUIRED',
            'INVALID_PHONE',
            'INVALID_EMAIL',
            'INVALID_DATE_OF_BIRTH',
          ],
        },
        { rowNumber: 5, errorCodes: ['PHONE_REQUIRED'] },
      ],
      totalRows: 3,
    });
  });

  it('accepts Vietnamese day/month/year dates and rejects impossible or future dates', async () => {
    const data = Buffer.from(
      'Họ tên,Số điện thoại,Email,Ngày sinh\n' +
      'Nguyễn Lan Anh,0911396778,,28/10/2006\n' +
      'Nguyễn Thị Minh Ánh,0912907568,,05/05/2005\n' +
      'Vũ Thị Phương Thảo,0943357511,,\n' +
      'Nguyễn Ngày Sai,0912345670,,31/02/2006\n' +
      'Nguyễn Ngày Tương Lai,0912345671,,31/12/2099\n',
      'utf8',
    );

    await expect(parseCustomerImportFile(data, 'csv')).resolves.toMatchObject({
      records: [
        { rowNumber: 2, dateOfBirth: new Date('2006-10-28T00:00:00.000Z') },
        { rowNumber: 3, dateOfBirth: new Date('2005-05-05T00:00:00.000Z') },
        { rowNumber: 4, dateOfBirth: null },
      ],
      failures: [
        { rowNumber: 5, errorCodes: ['INVALID_DATE_OF_BIRTH'] },
        { rowNumber: 6, errorCodes: ['INVALID_DATE_OF_BIRTH'] },
      ],
      totalRows: 5,
    });
  });

  it('parses optional profile columns and validates the allowed sex values', async () => {
    const data = Buffer.from(
      'Họ tên,Số điện thoại,CCCD,address,place_of_origin,sex,place_of_issue\n' +
      'Nguyễn Thị Lan Anh,0912345678,001234567890,"12 Nguyễn Trãi, Thanh Xuân",Hà Nam,Nữ,Cục Cảnh sát\n' +
      'Trần Quốc Bảo,0987654321,,,,,\n' +
      'Lê Minh Anh,0900000000,,,,unknown,\n',
      'utf8',
    );

    await expect(parseCustomerImportFile(data, 'csv')).resolves.toMatchObject({
      records: [{
        rowNumber: 2,
        cccd: '001234567890',
        address: '12 Nguyễn Trãi, Thanh Xuân',
        placeOfOrigin: 'Hà Nam',
        sex: 'Nữ',
        placeOfIssue: 'Cục Cảnh sát',
      }, {
        rowNumber: 3,
        cccd: null,
        address: null,
        placeOfOrigin: null,
        sex: null,
        placeOfIssue: null,
      }],
      failures: [{ rowNumber: 4, errorCodes: ['INVALID_SEX'] }],
      totalRows: 3,
    });
  });

  it('rejects malformed CSV and over-limit data', async () => {
    await expect(
      parseCustomerImportFile(Buffer.from('Họ tên,Số điện thoại\n"broken,0912345678'), 'csv'),
    ).rejects.toMatchObject({ code: 'INVALID_CSV' });
    await expect(
      parseCustomerImportFile(Buffer.alloc(20 * 1024 * 1024 + 1), 'csv'),
    ).rejects.toMatchObject({ code: 'FILE_SIZE_LIMIT_EXCEEDED' });
  });

  it('reads the first visible XLSX sheet and rejects formula cells', async () => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Khach hang');
    worksheet.addRow(['TT', 'Họ tên', 'Số điện thoại', 'Email', 'Ngày sinh', 'CCCD']);
    worksheet.addRow(['1', 'Nguyễn Thị Lan Anh', '0912345678', '', '1992-03-14', 1234567890]);
    worksheet.getCell('E2').value = new Date('1992-03-14T00:00:00.000Z');
    worksheet.getCell('E2').numFmt = 'dd/mm/yyyy';
    worksheet.getCell('F2').numFmt = '000000000000';
    const data = Buffer.from(await workbook.xlsx.writeBuffer());

    await expect(parseCustomerImportFile(data, 'xlsx')).resolves.toMatchObject({
      records: [{
        rowNumber: 2,
        fullName: 'Nguyễn Thị Lan Anh',
        dateOfBirth: new Date('1992-03-14T00:00:00.000Z'),
        cccd: '001234567890',
      }],
      failures: [],
      totalRows: 1,
    });

    worksheet.getCell('B2').value = { formula: 'CONCAT("Nguyễn"," An")' };
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
