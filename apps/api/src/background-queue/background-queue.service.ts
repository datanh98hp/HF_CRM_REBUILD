import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { BACKGROUND_QUEUE } from './background-queue.constants.js';

@Injectable()
export class BackgroundQueueService implements OnModuleDestroy {
  private readonly logger = new Logger(BackgroundQueueService.name);

  constructor(@Inject(BACKGROUND_QUEUE) private readonly queue: Queue) {}

  async enqueue(
    name: string,
    data: Record<string, unknown>,
    jobId?: string,
  ): Promise<Job<Record<string, unknown>>> {
    if (!name.trim()) throw new Error('Background job name is required');
    return this.queue.add(name, data, jobId ? { jobId } : undefined);
  }

  async isReady(): Promise<boolean> {
    let timeout: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.queue.getJobCounts(),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new Error('Queue readiness timeout')), 1_500);
          timeout.unref();
        }),
      ]);
      return true;
    } catch {
      return false;
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.queue.close();
    } catch (error) {
      this.logger.error(
        'Failed to close background queue cleanly',
        error instanceof Error ? error.name : 'UnknownError',
      );
    }
  }
}
