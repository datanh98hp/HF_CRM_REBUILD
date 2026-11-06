import { Module } from '@nestjs/common';
import { BackgroundQueueModule } from '../background-queue/background-queue.module.js';
import { PrismaModule } from '../database/prisma.module.js';
import { DatabaseHealthService } from './database-health.service.js';
import { HealthController } from './health.controller.js';

@Module({
  imports: [PrismaModule, BackgroundQueueModule],
  controllers: [HealthController],
  providers: [DatabaseHealthService],
})
export class HealthModule {}
