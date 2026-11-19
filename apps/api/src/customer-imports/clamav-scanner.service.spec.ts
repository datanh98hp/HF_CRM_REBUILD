import { createServer, type Server } from 'node:net';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ClamAvProtocolError,
  ClamAvScannerService,
} from './clamav-scanner.service.js';

async function startClamServer(
  reply: string,
): Promise<{ server: Server; port: number; getReceivedFile: () => Buffer }> {
  let receivedFile = Buffer.alloc(0);
  const server = createServer((socket) => {
    let buffer = Buffer.alloc(0);
    let command: string | undefined;

    socket.on('data', (data) => {
      buffer = Buffer.concat([buffer, data]);
      if (!command) {
        const end = buffer.indexOf(0);
        if (end < 0) return;
        command = buffer.subarray(0, end).toString('utf8');
        buffer = buffer.subarray(end + 1);
        if (command === 'zPING') {
          socket.end('PONG\0');
          return;
        }
      }

      if (command !== 'zINSTREAM') return;
      while (buffer.length >= 4) {
        const length = buffer.readUInt32BE(0);
        if (buffer.length < 4 + length) return;
        buffer = buffer.subarray(4);
        if (length === 0) {
          socket.end(`${reply}\0`);
          return;
        }
        receivedFile = Buffer.concat([receivedFile, buffer.subarray(0, length)]);
        buffer = buffer.subarray(length);
      }
    });

  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('ClamAV test server did not bind');
  return { server, port: address.port, getReceivedFile: () => receivedFile };
}

describe('ClamAvScannerService', () => {
  let directory: string;
  let filePath: string;
  let server: Server | undefined;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'clamav-scan-'));
    filePath = join(directory, 'synthetic.upload');
    await writeFile(filePath, 'synthetic file data');
  });

  afterEach(async () => {
    if (server?.listening) {
      await new Promise<void>((resolve, reject) => {
        server?.close((error) => (error ? reject(error) : resolve()));
      });
    }
    await rm(directory, { recursive: true, force: true });
  });

  async function scannerFor(reply: string): Promise<{
    scanner: ClamAvScannerService;
    getReceivedFile: () => Buffer;
  }> {
    const started = await startClamServer(reply);
    server = started.server;
    return {
      scanner: new ClamAvScannerService({
        host: '127.0.0.1',
        port: started.port,
        timeoutMs: 2_000,
      }),
      getReceivedFile: started.getReceivedFile,
    };
  }

  it('uses the ClamAV health command for readiness checks', async () => {
    const { scanner } = await scannerFor('stream: OK');

    await expect(scanner.ping()).resolves.toBeUndefined();
  });

  it('streams file contents and accepts only a clean ClamAV response', async () => {
    const { scanner, getReceivedFile } = await scannerFor('stream: OK');

    await expect(scanner.scanFile(filePath)).resolves.toBe('CLEAN');
    expect(getReceivedFile().toString('utf8')).toBe('synthetic file data');
  });

  it('marks a detected file as infected', async () => {
    const { scanner } = await scannerFor('stream: Eicar-Test-Signature FOUND');

    await expect(scanner.scanFile(filePath)).resolves.toBe('INFECTED');
  });

  it('fails closed on scanner errors', async () => {
    const { scanner } = await scannerFor('stream: size limit exceeded ERROR');

    await expect(scanner.scanFile(filePath)).rejects.toBeInstanceOf(ClamAvProtocolError);
  });
});
