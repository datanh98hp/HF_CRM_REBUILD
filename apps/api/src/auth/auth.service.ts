import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { ActorContext, ActorRequest } from '../common/actor-context.js';
import { AccessControlService } from '../access-control/access-control.service.js';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { RuntimeConfigService } from '../runtime-config/runtime-config.service.js';
import { AccessTokenService } from './access-token.service.js';
import { PasswordHasherService } from './password-hasher.service.js';
import { LoginRateLimitService } from './login-rate-limit.service.js';

const genericLoginError = 'Invalid username or password';
const maxFailedLogins = 5;
const lockDurationMs = 15 * 60 * 1000;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function tokenMatches(storedHash: string, token: string): boolean {
  const stored = Buffer.from(storedHash, 'hex');
  const supplied = Buffer.from(hashToken(token), 'hex');
  return stored.length === supplied.length && timingSafeEqual(stored, supplied);
}

function requestId(request?: ActorRequest): string | null {
  const value = request?.headers['x-request-id'];
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: RuntimeConfigService,
    private readonly tokens: AccessTokenService,
    private readonly passwords: PasswordHasherService,
    private readonly accessControl: AccessControlService,
    private readonly audit: AuditService,
    private readonly loginRateLimit: LoginRateLimitService,
  ) {}

  async login(
    username: string,
    password: string,
    request?: ActorRequest,
  ) {
    const clientIp = request?.ip ?? 'unknown';
    this.loginRateLimit.assertAllowed(clientIp);
    const normalizedUsername = username.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { username: normalizedUsername } });
    const now = new Date();
    const passwordMatches = user
      ? await this.passwords.verify(password, user.passwordHash)
      : await this.passwords.verify(password, this.invalidPasswordHash());

    if (
      !user || user.status !== 'ACTIVE' ||
      (user.lockedUntil && user.lockedUntil > now) || !passwordMatches
    ) {
      this.loginRateLimit.recordFailure(clientIp);
      if (user && user.status === 'ACTIVE' && (!user.lockedUntil || user.lockedUntil <= now)) {
        const nextCount = user.failedLoginCount + 1;
        await this.prisma.user.update({
          where: { id: user.id },
          data: {
            failedLoginCount: { increment: 1 },
            lockedUntil: nextCount >= maxFailedLogins
              ? new Date(now.getTime() + lockDurationMs)
              : null,
          },
        });
      }
      throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS', message: genericLoginError });
    }
    this.loginRateLimit.clear(clientIp);

    const refreshToken = randomBytes(48).toString('base64url');
    const expiresAt = new Date(
      now.getTime() + this.config.value.authRefreshTokenTtlDays * 24 * 60 * 60 * 1000,
    );
    const session = await this.prisma.$transaction(async (tx) => {
      const updatedUser = await tx.user.update({
        where: { id: user.id },
        data: { failedLoginCount: 0, lockedUntil: null },
      });
      const createdSession = await tx.authSession.create({
        data: { userId: updatedUser.id, refreshTokenHash: hashToken(refreshToken), expiresAt },
      });
      await this.audit.write(tx, {
        actor: { id: updatedUser.id, type: 'STAFF', sessionId: createdSession.id },
        action: 'auth.session.created',
        targetType: 'auth_session',
        targetId: createdSession.id,
        afterState: { username: updatedUser.username },
        requestId: requestId(request),
      });
      return createdSession;
    });

    return {
      ...this.tokenPair(user.id, session.id, refreshToken),
      passwordChangeRequired: user.mustChangePassword,
    };
  }

  async refresh(sessionId: string, refreshToken: string, request?: ActorRequest) {
    const replacement = randomBytes(48).toString('base64url');
    const replacementHash = hashToken(replacement);
    const result = await this.prisma.$transaction(async (tx) => {
      const session = await tx.authSession.findUnique({
        where: { id: sessionId },
        include: { user: { select: { id: true, status: true, mustChangePassword: true } } },
      });
      const now = new Date();
      if (!session || session.revokedAt || session.expiresAt <= now || session.user.status !== 'ACTIVE') {
        return { error: 'invalid' as const };
      }

      if (!tokenMatches(session.refreshTokenHash, refreshToken)) {
        await tx.authSession.update({ where: { id: session.id }, data: { revokedAt: now } });
        await this.audit.write(tx, {
          actor: { id: session.userId, type: 'STAFF', sessionId: session.id },
          action: 'auth.session.reuse_detected',
          targetType: 'auth_session',
          targetId: session.id,
          requestId: requestId(request),
        });
        return { error: 'reuse' as const };
      }

      const updated = await tx.authSession.updateMany({
        where: {
          id: session.id,
          refreshTokenHash: session.refreshTokenHash,
          revokedAt: null,
          expiresAt: { gt: now },
        },
        data: { refreshTokenHash: replacementHash, lastUsedAt: now },
      });
      if (updated.count !== 1) return { error: 'reuse' as const };
      await this.audit.write(tx, {
        actor: { id: session.userId, type: 'STAFF', sessionId: session.id },
        action: 'auth.session.refreshed',
        targetType: 'auth_session',
        targetId: session.id,
        requestId: requestId(request),
      });
      return {
        userId: session.userId,
        sessionId: session.id,
        passwordChangeRequired: session.user.mustChangePassword,
      };
    });

    if ('error' in result) {
      if (result.error === 'reuse') {
        await this.prisma.authSession.updateMany({
          where: { id: sessionId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      throw new UnauthorizedException({ code: 'INVALID_SESSION', message: 'Session is invalid or expired' });
    }
    return {
      ...this.tokenPair(result.userId, result.sessionId, replacement),
      passwordChangeRequired: result.passwordChangeRequired,
    };
  }

  async changePassword(
    actor: ActorContext,
    currentPassword: string,
    newPassword: string,
    request?: ActorRequest,
  ) {
    if (actor.type !== 'STAFF' || !actor.sessionId) throw new UnauthorizedException();
    if (currentPassword === newPassword) {
      throw new BadRequestException({ code: 'NEW_PASSWORD_MUST_DIFFER' });
    }
    const user = await this.prisma.user.findUnique({ where: { id: actor.id } });
    if (!user || user.status !== 'ACTIVE' || !(await this.passwords.verify(currentPassword, user.passwordHash))) {
      throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS', message: genericLoginError });
    }
    const nextPasswordHash = await this.passwords.hash(newPassword);
    const nextRefreshToken = randomBytes(48).toString('base64url');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.config.value.authRefreshTokenTtlDays * 24 * 60 * 60 * 1000);

    await this.prisma.$transaction(async (tx) => {
      const session = await tx.authSession.findFirst({
        where: { id: actor.sessionId, userId: actor.id, revokedAt: null, expiresAt: { gt: now } },
      });
      if (!session) throw new UnauthorizedException();
      await tx.user.update({
        where: { id: actor.id },
        data: {
          passwordHash: nextPasswordHash,
          passwordChangedAt: now,
          mustChangePassword: false,
          failedLoginCount: 0,
          lockedUntil: null,
        },
      });
      await tx.authSession.updateMany({
        where: { userId: actor.id, id: { not: actor.sessionId }, revokedAt: null },
        data: { revokedAt: now },
      });
      const rotated = await tx.authSession.updateMany({
        where: { id: actor.sessionId, revokedAt: null, expiresAt: { gt: now } },
        data: { refreshTokenHash: hashToken(nextRefreshToken), expiresAt, lastUsedAt: now },
      });
      if (rotated.count !== 1) throw new UnauthorizedException();
      await this.audit.write(tx, {
        actor,
        action: 'identity.password.changed',
        targetType: 'user',
        targetId: actor.id,
        requestId: requestId(request),
      });
    });

    return {
      ...this.tokenPair(actor.id, actor.sessionId, nextRefreshToken),
      passwordChangeRequired: false,
    };
  }

  async logout(actor: ActorContext, request?: ActorRequest): Promise<{ status: 'ok' }> {
    if (actor.type !== 'STAFF' || !actor.sessionId) {
      throw new UnauthorizedException();
    }
    await this.prisma.$transaction(async (tx) => {
      const session = await tx.authSession.findUnique({ where: { id: actor.sessionId } });
      if (!session || session.revokedAt) return;
      await tx.authSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
      await this.audit.write(tx, {
        actor,
        action: 'auth.session.revoked',
        targetType: 'auth_session',
        targetId: session.id,
        requestId: requestId(request),
      });
    });
    return { status: 'ok' };
  }

  async me(actor: ActorContext) {
    if (actor.type === 'CUSTOMER') {
      return { id: actor.id, type: actor.type, roles: ['CUSTOMER'], permissions: [], isMock: actor.isMock ?? false };
    }
    const user = await this.prisma.user.findUnique({
      where: { id: actor.id },
      select: { id: true, username: true, displayName: true, status: true, mustChangePassword: true },
    });
    if (!user || user.status !== 'ACTIVE') throw new UnauthorizedException();
    const access = await this.accessControl.effectivePermissions(user.id);
    return { ...user, type: actor.type, ...access };
  }

  mockCustomerToken(customerId: string) {
    if (this.config.value.nodeEnv === 'production') throw new UnauthorizedException();
    return {
      accessToken: this.tokens.sign({ sub: customerId, actorType: 'CUSTOMER', mockCustomer: true }),
      tokenType: 'Bearer' as const,
      expiresIn: this.config.value.authAccessTokenTtlSeconds,
    };
  }

  private tokenPair(userId: string, sessionId: string, refreshToken: string) {
    return {
      accessToken: this.tokens.sign({ sub: userId, sid: sessionId, actorType: 'STAFF' }),
      refreshToken,
      sessionId,
      tokenType: 'Bearer' as const,
      expiresIn: this.config.value.authAccessTokenTtlSeconds,
    };
  }

  private invalidPasswordHash(): string {
    // Stable valid-format hash keeps unknown-user failures on the password verification path.
    return 'scrypt$32768$8$1$MDEyMzQ1Njc4OWFiY2RlZg$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  }
}
