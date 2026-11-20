import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Job, UnrecoverableError, Worker } from 'bullmq';
import { BACKGROUND_QUEUE_NAME } from '../background-queue/background-queue.constants.js';
import { redisConnectionOptions } from '../background-queue/redis-connection.js';
import { CustomerImportWorkerService } from '../customer-imports/customer-import-worker.service.js';
import { RuntimeConfigService } from '../runtime-config/runtime-config.service.js';

@Injectable()
export class WorkerRuntimeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WorkerRuntimeService.name);
  private worker: Worker | undefined;
  private failureDetailsCleanupTimer: NodeJS.Timeout | undefined;

  constructor(
    private readonly config: RuntimeConfigService,
    private readonly customerImports: CustomerImportWorkerService,
  ) {}

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
    await this.cleanupExpiredFailureDetails();
    this.failureDetailsCleanupTimer = setInterval(() => {
      void this.cleanupExpiredFailureDetails();
    }, 60 * 60 * 1_000);
    this.failureDetailsCleanupTimer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.failureDetailsCleanupTimer) clearInterval(this.failureDetailsCleanupTimer);
    await this.worker?.close();
  }

  private async process(job: Job<Record<string, unknown>>): Promise<{ status: string }> {
    if (job.name === 'system.healthcheck') return { status: 'ok' };
    if (job.name === 'customer-import.process') {
      const { batchId, format } = job.data;
      if (typeof batchId !== 'string' || (format !== 'csv' && format !== 'xlsx')) {
        throw new UnrecoverableError('Customer import job metadata is invalid');
      }
      return this.customerImports.process(batchId, format);
    }
    throw new UnrecoverableError(`No processor is registered for job type: ${job.name}`);
  }

  private async cleanupExpiredFailureDetails(): Promise<void> {
    try {
      const deletedRows = await this.customerImports.cleanupExpiredFailureDetails();
      if (deletedRows) {
        this.logger.log(`Purged expired customer import row details (rows=${deletedRows})`);
      }
    } catch (error) {
      this.logger.error(
        'Failed to purge expired customer import row details',
        error instanceof Error ? error.name : 'UnknownError',
      );
    }
  }
}
