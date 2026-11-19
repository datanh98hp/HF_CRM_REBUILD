import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { PrismaModule } from '../database/prisma.module.js';
import { CustomerImportFilesModule } from './customer-import-files.module.js';
import { CustomerImportWorkerService } from './customer-import-worker.service.js';

@Module({
  imports: [PrismaModule, AuditModule, CustomerImportFilesModule],
  providers: [CustomerImportWorkerService],
  exports: [CustomerImportWorkerService],
})
export class CustomerImportWorkerModule {}
