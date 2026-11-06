import { Module } from '@nestjs/common';
import { RuntimeConfigModule } from '../runtime-config/runtime-config.module.js';
import { WorkerRuntimeService } from './worker-runtime.service.js';

@Module({
  imports: [RuntimeConfigModule],
  providers: [WorkerRuntimeService],
})
export class WorkerModule {}
