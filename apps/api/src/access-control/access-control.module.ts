import { Global, Module } from '@nestjs/common';
import { AccessControlService } from './access-control.service.js';
import { PermissionGuard } from './permission.guard.js';
import { AccessAdminController } from './access-admin.controller.js';
import { AccessAdminService } from './access-admin.service.js';

@Global()
@Module({
  controllers: [AccessAdminController],
  providers: [AccessControlService, PermissionGuard, AccessAdminService],
  exports: [AccessControlService, PermissionGuard, AccessAdminService],
})
export class AccessControlModule {}
