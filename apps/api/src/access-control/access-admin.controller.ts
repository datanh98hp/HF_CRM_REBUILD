import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AccessScope } from '../generated/prisma/client.js';
import { CurrentActor } from '../common/actor-context.js';
import type { ActorContext, ActorRequest } from '../common/actor-context.js';
import { RequirePermission } from '../common/auth-metadata.js';
import { AccessAdminService } from './access-admin.service.js';
import {
  CreateBranchDto,
  AssignBranchManagerDto,
  CreateRoleDto,
  CreateRoleGrantDto,
  CreateUserDto,
  DisableUserDto,
  RevokeRoleGrantDto,
  SetRolePermissionsDto,
  UpdateBranchStatusDto,
} from './access.dto.js';

@Controller('access')
@ApiTags('access control')
@ApiBearerAuth()
export class AccessAdminController {
  constructor(private readonly access: AccessAdminService) {}

  @RequirePermission('permissions.read', AccessScope.ALL)
  @Get('permissions')
  listPermissions() {
    return this.access.listCatalog();
  }

  @RequirePermission('roles.read', AccessScope.ALL)
  @Get('roles')
  listRoles() {
    return this.access.listRoles();
  }

  @RequirePermission('roles.manage')
  @Post('roles')
  createRole(
    @CurrentActor() actor: ActorContext,
    @Body() dto: CreateRoleDto,
    @Req() request: ActorRequest,
  ) {
    return this.access.createRole(actor, dto, request);
  }

  @RequirePermission('roles.manage')
  @Put('roles/:roleKey/permissions')
  setRolePermissions(
    @CurrentActor() actor: ActorContext,
    @Param('roleKey') roleKey: string,
    @Body() dto: SetRolePermissionsDto,
    @Req() request: ActorRequest,
  ) {
    return this.access.setRolePermissions(actor, roleKey, dto, request);
  }

  @RequirePermission('branches.read')
  @Get('branches')
  listBranches(@CurrentActor() actor: ActorContext) {
    return this.access.listBranches(actor);
  }

  @RequirePermission('branches.manage')
  @Post('branches')
  createBranch(
    @CurrentActor() actor: ActorContext,
    @Body() dto: CreateBranchDto,
    @Req() request: ActorRequest,
  ) {
    return this.access.createBranch(actor, dto, request);
  }

  @RequirePermission('branches.manage')
  @Patch('branches/:branchId/status')
  updateBranchStatus(
    @CurrentActor() actor: ActorContext,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Body() dto: UpdateBranchStatusDto,
    @Req() request: ActorRequest,
  ) {
    return this.access.updateBranchStatus(actor, branchId, dto, request);
  }

  @RequirePermission('branches.manage', AccessScope.ALL)
  @Put('branches/:branchId/manager')
  assignBranchManager(
    @CurrentActor() actor: ActorContext,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Body() dto: AssignBranchManagerDto,
    @Req() request: ActorRequest,
  ) {
    return this.access.assignBranchManager(actor, branchId, dto.managerUserId, request);
  }

  @RequirePermission('users.read')
  @Get('users')
  listUsers(@CurrentActor() actor: ActorContext) {
    return this.access.listUsers(actor);
  }

  @RequirePermission('users.manage')
  @Post('users')
  createUser(
    @CurrentActor() actor: ActorContext,
    @Body() dto: CreateUserDto,
    @Req() request: ActorRequest,
  ) {
    return this.access.createUser(actor, dto, request);
  }

  @RequirePermission('users.manage')
  @Patch('users/:userId/disable')
  disableUser(
    @CurrentActor() actor: ActorContext,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: DisableUserDto,
    @Req() request: ActorRequest,
  ) {
    return this.access.setUserStatus(actor, userId, false, dto.reason, request);
  }

  @RequirePermission('users.manage')
  @Patch('users/:userId/enable')
  enableUser(
    @CurrentActor() actor: ActorContext,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: DisableUserDto,
    @Req() request: ActorRequest,
  ) {
    return this.access.setUserStatus(actor, userId, true, dto.reason, request);
  }

  @RequirePermission('roles.manage')
  @Post('role-grants')
  grantRole(
    @CurrentActor() actor: ActorContext,
    @Body() dto: CreateRoleGrantDto,
    @Req() request: ActorRequest,
  ) {
    return this.access.createRoleGrant(actor, dto, request);
  }

  @RequirePermission('roles.manage')
  @Delete('role-grants/:grantId')
  revokeRole(
    @CurrentActor() actor: ActorContext,
    @Param('grantId', ParseUUIDPipe) grantId: string,
    @Body() dto: RevokeRoleGrantDto,
    @Req() request: ActorRequest,
  ) {
    return this.access.revokeRoleGrant(actor, grantId, dto.reason, request);
  }

  @RequirePermission('audit.read')
  @Get('audit-events')
  listAuditEvents(@CurrentActor() actor: ActorContext, @Query('take') take = '100') {
    return this.access.listAuditEvents(actor, Number(take) || 100);
  }
}
