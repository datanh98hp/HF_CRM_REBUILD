import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ActorRequest } from '../common/actor-context.js';
import { PUBLIC_ROUTE } from '../common/auth-metadata.js';
import { RuntimeConfigService } from '../runtime-config/runtime-config.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { AccessTokenService } from './access-token.service.js';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: AccessTokenService,
    private readonly prisma: PrismaService,
    private readonly config: RuntimeConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, targets)) return true;

    const request = context.switchToHttp().getRequest<ActorRequest>();
    const rawAuthorization = request.headers.authorization;
    const authorization = Array.isArray(rawAuthorization) ? rawAuthorization[0] : rawAuthorization;
    const token = authorization?.match(/^Bearer ([A-Za-z0-9._-]+)$/)?.[1];
    if (!token) throw new UnauthorizedException();

    const payload = this.tokens.verify(token);
    if (payload.actorType === 'CUSTOMER') {
      if (
        !payload.mockCustomer ||
        this.config.value.nodeEnv === 'production'
      ) throw new UnauthorizedException();
      request.actor = { id: payload.sub, type: 'CUSTOMER', isMock: true };
      return true;
    }

    if (!payload.sid) throw new UnauthorizedException();
    const session = await this.prisma.authSession.findFirst({
      where: {
        id: payload.sid,
        userId: payload.sub,
        revokedAt: null,
        expiresAt: { gt: new Date() },
        user: { status: 'ACTIVE' },
      },
      select: { id: true, userId: true, user: { select: { mustChangePassword: true } } },
    });
    if (!session) throw new UnauthorizedException();
    request.actor = {
      id: session.userId,
      type: 'STAFF',
      sessionId: session.id,
      mustChangePassword: session.user.mustChangePassword,
    };
    return true;
  }
}
