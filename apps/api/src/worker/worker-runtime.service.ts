import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Job, UnrecoverableError, Worker } from 'bullmq';
import { BACKGROUND_QUEUE_NAME } from '../background-queue/background-queue.constants.js';
import { redisConnectionOptions } from '../background-queue/redis-connection.js';
import { RuntimeConfigService } from '../runtime-config/runtime-config.service.js';

@Injectable()
export class WorkerRuntimeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WorkerRuntimeService.name);
  private worker: Worker | undefined;

  constructor(private readonly config: RuntimeConfigService) {}

  async onModuleInit(): Promise<void> {
    this.worker = new Worker(
      BACKGROUND_QUEUE_NAME,
      async (job: Job<Record<string, unknown>>) => this.process(job),
      {
        connection: redisConnectionOptions(this.config.value.redisUrl, null),
        concurrency: this.config.value.workerConcurrency,
      },
    );

    this.worker.on('ready', () => this.logger.log('Background worker is ready'));
    this.worker.on('error', (error: Error) => {
      this.logger.error('Background worker encountered an error', error.name);
    });
    this.worker.on('failed', (job, error: Error) => {
      this.logger.error(
        `Background job failed (name=${job?.name ?? 'unknown'}, id=${job?.id ?? 'unknown'})`,
        error.name,
      );
    });

    await this.worker.waitUntilReady();
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
  }

  private async process(job: Job<Record<string, unknown>>): Promise<{ status: 'ok' }> {
    if (job.name === 'system.healthcheck') return { status: 'ok' };
    throw new UnrecoverableError(`No processor is registered for job type: ${job.name}`);
  }
}
