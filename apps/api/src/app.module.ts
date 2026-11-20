import { Module } from '@nestjs/common';
import { AccessControlModule } from './access-control/access-control.module.js';
import { AuditModule } from './audit/audit.module.js';
import { AuthModule } from './auth/auth.module.js';
import { BackgroundQueueModule } from './background-queue/background-queue.module.js';
import { PrismaModule } from './database/prisma.module.js';
import { RuntimeConfigModule } from './runtime-config/runtime-config.module.js';
import { HealthModule } from './health/health.module.js';
import { CustomersModule } from './customers/customers.module.js';
import { CapabilitiesController } from './capabilities/capabilities.controller.js';
import { PlansModule } from './plans/plans.module.js';
import { CustomerImportsModule } from './customer-imports/customer-imports.module.js';

@Module({
  imports: [
    RuntimeConfigModule,
    PrismaModule,
    BackgroundQueueModule,
    AccessControlModule,
    AuditModule,
    AuthModule,
    // Register the static import-batches route before the generic customers/:customerId route.
    CustomerImportsModule,
    CustomersModule,
    PlansModule,
    HealthModule,
  ],
  controllers: [CapabilitiesController],
})
export class AppModule {}
