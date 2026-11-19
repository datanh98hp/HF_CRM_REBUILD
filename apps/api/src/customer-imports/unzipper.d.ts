declare module 'unzipper' {
  import { Readable, Writable } from 'node:stream';

  export interface Entry extends Readable {
    path: string;
    type: string;
    autodrain(): Readable;
  }

  export interface ParseStream extends Writable {
    [Symbol.asyncIterator](): AsyncIterator<Entry>;
  }

  export function Parse(options?: { forceStream?: boolean }): ParseStream;
}
