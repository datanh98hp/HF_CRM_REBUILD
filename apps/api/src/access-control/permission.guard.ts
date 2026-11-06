import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ActorRequest } from '../common/actor-context.js';
import {
  AUTHENTICATED_ROUTE,
  PASSWORD_CHANGE_ROUTE,
  PUBLIC_ROUTE,
  REQUIRED_PERMISSION,
} from '../common/auth-metadata.js';
import { AccessControlService } from './access-control.service.js';

interface PermissionMetadata {
  key: string;
  scope?: import('../generated/prisma/client.js').AccessScope;
}

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly accessControl: AccessControlService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, targets)) return true;

    const request = context.switchToHttp().getRequest<ActorRequest>();
    if (!request.actor) throw new UnauthorizedException();
    if (
      request.actor.mustChangePassword &&
      !this.reflector.getAllAndOverride<boolean>(PASSWORD_CHANGE_ROUTE, targets)
    ) {
      throw new ForbiddenException({ code: 'PASSWORD_CHANGE_REQUIRED' });
    }
    if (request.actor.type === 'CUSTOMER' && request.actor.isMock) {
      if (this.reflector.getAllAndOverride<boolean>(AUTHENTICATED_ROUTE, targets)) return true;
      throw new ForbiddenException({ code: 'CUSTOMER_MOCK_RESTRICTED' });
    }

    if (this.reflector.getAllAndOverride<boolean>(AUTHENTICATED_ROUTE, targets)) return true;
    const permission = this.reflector.getAllAndOverride<PermissionMetadata>(
      REQUIRED_PERMISSION,
      targets,
    );
    if (!permission) {
      throw new ForbiddenException({ code: 'PERMISSION_NOT_CONFIGURED' });
    }

    const targetBranchId = request.params.branchId;
    await this.accessControl.assertPermission(
      request.actor.id,
      permission.key,
      permission.scope,
      targetBranchId,
    );
    return true;
  }
}
