import { Module } from '@nestjs/common';
import { CustomerImportsController } from './customer-imports.controller.js';
import { CustomerImportsService } from './customer-imports.service.js';
import { CustomerImportFilesModule } from './customer-import-files.module.js';
import { AccessControlModule } from '../access-control/access-control.module.js';

@Module({
  imports: [CustomerImportFilesModule, AccessControlModule],
  controllers: [CustomerImportsController],
  providers: [CustomerImportsService],
})
export class CustomerImportsModule {}
