import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { RuntimeConfigService } from '../runtime-config/runtime-config.service.js';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(config: RuntimeConfigService) {
    const adapter = new PrismaPg({
      connectionString: config.value.databaseUrl,
      max: 5,
      connectionTimeoutMillis: 1_500,
      idleTimeoutMillis: 10_000,
    });
    super({ adapter });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
