import { Injectable } from '@nestjs/common';
import { createConnection, type Socket } from 'node:net';
import { createReadStream } from 'node:fs';

const STREAM_COMMAND = Buffer.from('zINSTREAM\0');
const PING_COMMAND = Buffer.from('zPING\0');
const MAX_REPLY_BYTES = 4_096;
const READ_CHUNK_BYTES = 64 * 1024;
const READINESS_TIMEOUT_MS = 1_500;

export interface ClamAvScannerOptions {
  host: string;
  port: number;
  timeoutMs: number;
}

export class ClamAvTransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClamAvTransportError';
  }
}

export class ClamAvProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClamAvProtocolError';
  }
}

type ReplyReader = {
  promise: Promise<string>;
  cancel: () => void;
};

function readReply(socket: Socket, timeoutMs: number): ReplyReader {
  let buffer = Buffer.alloc(0);
  let settled = false;
  let timer: NodeJS.Timeout | undefined;
  let resolveReply: (reply: string) => void = () => undefined;
  let rejectReply: (error: Error) => void = () => undefined;

  const promise = new Promise<string>((resolve, reject) => {
    resolveReply = resolve;
    rejectReply = reject;
  });
  void promise.catch(() => undefined);

  const cleanup = () => {
    if (timer) clearTimeout(timer);
    socket.off('data', onData);
    socket.off('error', onError);
    socket.off('close', onClose);
  };
  const finish = (error?: Error, reply?: string) => {
    if (settled) return;
    settled = true;
    cleanup();
    if (error) rejectReply(error);
    else resolveReply(reply ?? '');
  };
  const onData = (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    if (buffer.length > MAX_REPLY_BYTES) {
      finish(new ClamAvProtocolError('ClamAV returned an oversized response'));
      return;
    }
    const terminator = buffer.indexOf(0);
    if (terminator >= 0) {
      finish(undefined, buffer.subarray(0, terminator).toString('utf8').trim());
    }
  };
  const onError = () => finish(new ClamAvTransportError('ClamAV connection failed'));
  const onClose = () => finish(new ClamAvTransportError('ClamAV closed the connection'));

  socket.on('data', onData);
  socket.once('error', onError);
  socket.once('close', onClose);
  timer = setTimeout(
    () => finish(new ClamAvTransportError('ClamAV request timed out')),
    timeoutMs,
  );
  timer.unref();

  return {
    promise,
    cancel: () => {
      if (settled) return;
      settled = true;
      cleanup();
    },
  };
}

function writeSocket(socket: Socket, data: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.write(data, (error?: Error | null) => {
      if (error) reject(new ClamAvTransportError('ClamAV connection failed'));
      else resolve();
    });
  });
}

@Injectable()
export class ClamAvScannerService {
  constructor(private readonly options: ClamAvScannerOptions) {}

  async isAvailable(): Promise<boolean> {
    try {
      await this.ping();
      return true;
    } catch (error) {
      if (error instanceof ClamAvTransportError || error instanceof ClamAvProtocolError) {
        return false;
      }
      throw error;
    }
  }

  async ping(): Promise<void> {
    const reply = await this.request(
      async (socket) => writeSocket(socket, PING_COMMAND),
      READINESS_TIMEOUT_MS,
    );
    if (reply !== 'PONG') {
      throw new ClamAvProtocolError('ClamAV health check returned an unexpected response');
    }
  }

  async scanFile(path: string): Promise<'CLEAN' | 'INFECTED'> {
    const reply = await this.request(async (socket) => {
      await writeSocket(socket, STREAM_COMMAND);

      for await (const chunk of createReadStream(path, {
        highWaterMark: READ_CHUNK_BYTES,
      })) {
        const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        const size = Buffer.allocUnsafe(4);
        size.writeUInt32BE(data.length);
        await writeSocket(socket, size);
        await writeSocket(socket, data);
      }

      await writeSocket(socket, Buffer.alloc(4));
    }, this.options.timeoutMs);

    if (reply.endsWith(' OK')) return 'CLEAN';
    if (reply.endsWith(' FOUND')) return 'INFECTED';
    throw new ClamAvProtocolError('ClamAV did not return a clean scan result');
  }

  private async request(
    send: (socket: Socket) => Promise<void>,
    timeoutMs: number,
  ): Promise<string> {
    const socket = await this.connect(timeoutMs);
    const reply = readReply(socket, timeoutMs);

    try {
      await send(socket);
      return await reply.promise;
    } catch (error) {
      reply.cancel();
      throw error;
    } finally {
      socket.destroy();
    }
  }

  private connect(timeoutMs: number): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const socket = createConnection({
        host: this.options.host,
        port: this.options.port,
      });
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.off('connect', onConnect);
        socket.off('error', onError);
        if (error) {
          socket.destroy();
          reject(error);
        } else {
          resolve(socket);
        }
      };
      const onConnect = () => {
        finish();
      };
      const onError = () => {
        finish(new ClamAvTransportError('ClamAV is unavailable'));
      };
      const timer = setTimeout(
        () => finish(new ClamAvTransportError('ClamAV connection timed out')),
        timeoutMs,
      );
      timer.unref();

      socket.once('connect', onConnect);
      socket.once('error', onError);
    });
  }
}
