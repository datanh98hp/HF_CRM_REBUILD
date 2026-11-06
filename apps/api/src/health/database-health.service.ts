import { Injectable } from '@nestjs/common';
import { BackgroundQueueService } from '../background-queue/background-queue.service.js';
import { PrismaService } from '../database/prisma.service.js';

@Injectable()
export class DatabaseHealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: BackgroundQueueService,
  ) {}

  async isReady(): Promise<boolean> {
    try {
      const [databaseReady, queueReady] = await Promise.all([
        this.prisma.$queryRaw`SELECT 1`.then(() => true, () => false),
        this.queue.isReady(),
      ]);
      return databaseReady && queueReady;
    } catch {
      return false;
    }
  }
}
