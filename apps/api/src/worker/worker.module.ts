import { Module } from '@nestjs/common';
import { RuntimeConfigModule } from '../runtime-config/runtime-config.module.js';
import { CustomerImportWorkerModule } from '../customer-imports/customer-import-worker.module.js';
import { WorkerRuntimeService } from './worker-runtime.service.js';

@Module({
  imports: [RuntimeConfigModule, CustomerImportWorkerModule],
  providers: [WorkerRuntimeService],
})
export class WorkerModule {}
