import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker/worker.module.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    bufferLogs: true,
  });
  app.enableShutdownHooks();
}

void bootstrap().catch((error: unknown) => {
  const logger = new Logger('WorkerBootstrap');
  logger.error(
    'Worker failed to start',
    error instanceof Error ? error.name : 'UnknownError',
  );
  process.exitCode = 1;
});
