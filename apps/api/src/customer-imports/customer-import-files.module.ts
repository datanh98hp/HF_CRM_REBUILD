import { Module } from '@nestjs/common';
import { RuntimeConfigModule } from '../runtime-config/runtime-config.module.js';
import { RuntimeConfigService } from '../runtime-config/runtime-config.service.js';
import { ClamAvScannerService } from './clamav-scanner.service.js';
import { CustomerImportTempStorageService } from './customer-import-temp-storage.service.js';

@Module({
  imports: [RuntimeConfigModule],
  providers: [
    {
      provide: CustomerImportTempStorageService,
      inject: [RuntimeConfigService],
      useFactory: (config: RuntimeConfigService) =>
        new CustomerImportTempStorageService(config.value.customerImportTempDirectory),
    },
    {
      provide: ClamAvScannerService,
      inject: [RuntimeConfigService],
      useFactory: (config: RuntimeConfigService) =>
        new ClamAvScannerService({
          host: config.value.customerImportScannerHost,
          port: config.value.customerImportScannerPort,
          timeoutMs: config.value.customerImportScannerTimeoutMs,
        }),
    },
  ],
  exports: [CustomerImportTempStorageService, ClamAvScannerService],
})
export class CustomerImportFilesModule {}
