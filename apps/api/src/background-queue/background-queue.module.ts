import { Global, Module } from '@nestjs/common';
import { Queue } from 'bullmq';
import { BACKGROUND_QUEUE, BACKGROUND_QUEUE_NAME } from './background-queue.constants.js';
import { BackgroundQueueService } from './background-queue.service.js';
import { redisConnectionOptions } from './redis-connection.js';
import { RuntimeConfigService } from '../runtime-config/runtime-config.service.js';

@Global()
@Module({
  providers: [
    {
      provide: BACKGROUND_QUEUE,
      inject: [RuntimeConfigService],
      useFactory: (config: RuntimeConfigService) =>
        new Queue(BACKGROUND_QUEUE_NAME, {
          connection: redisConnectionOptions(config.value.redisUrl, 1),
          defaultJobOptions: {
            attempts: 5,
            backoff: { type: 'exponential', delay: 1_000 },
            removeOnComplete: { age: 86_400, count: 1_000 },
            removeOnFail: { age: 604_800 },
          },
        }),
    },
    BackgroundQueueService,
  ],
  exports: [BackgroundQueueService],
})
export class BackgroundQueueModule {}
