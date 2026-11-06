import { Body, Controller, Get, Post, Req, Res, UnauthorizedException } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Authenticated, PasswordChangeAllowed, Public } from '../common/auth-metadata.js';
import { CurrentActor } from '../common/actor-context.js';
import type { ActorContext, ActorRequest } from '../common/actor-context.js';
import { RuntimeConfigService } from '../runtime-config/runtime-config.service.js';
import { AuthService } from './auth.service.js';
import { ChangePasswordDto, LoginDto, MockCustomerTokenDto } from './auth.dto.js';

interface CookieResponse {
  setHeader(name: string, value: string): void;
}

interface TokenPair {
  accessToken: string;
  refreshToken: string;
  sessionId: string;
  tokenType: 'Bearer';
  expiresIn: number;
  passwordChangeRequired?: boolean;
}

function cookieOptions(config: RuntimeConfigService, maxAgeSeconds: number): string {
  return `Path=/api/v1/auth; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}${config.value.nodeEnv === 'production' ? '; Secure' : ''}`;
}

function readRefreshCookie(request: ActorRequest): { sessionId: string; token: string } {
  const rawCookie = request.headers.cookie;
  const header = Array.isArray(rawCookie) ? rawCookie[0] : rawCookie;
  const refreshCookies = header?.split(';').map((part) => part.trim())
    .filter((part) => part.startsWith('crm_refresh=')) ?? [];
  if (refreshCookies.length !== 1) throw new UnauthorizedException({ code: 'INVALID_SESSION' });
  const encoded = refreshCookies[0].slice('crm_refresh='.length);
  let value = '';
  try {
    value = encoded ? decodeURIComponent(encoded) : '';
  } catch {
    throw new UnauthorizedException({ code: 'INVALID_SESSION' });
  }
  const [sessionId, token, extra] = value.split('.');
  if (
    !/^[0-9a-f-]{36}$/i.test(sessionId ?? '') ||
    !/^[A-Za-z0-9_-]{40,100}$/.test(token ?? '') || extra !== undefined
  ) throw new UnauthorizedException({ code: 'INVALID_SESSION' });
  return { sessionId, token };
}

@Controller('auth')
@ApiTags('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: RuntimeConfigService,
  ) {}

  private publishTokenPair(result: TokenPair, response: CookieResponse) {
    const maxAge = this.config.value.authRefreshTokenTtlDays * 24 * 60 * 60;
    response.setHeader(
      'Set-Cookie',
      `crm_refresh=${encodeURIComponent(`${result.sessionId}.${result.refreshToken}`)}; ${cookieOptions(this.config, maxAge)}`,
    );
    response.setHeader('Cache-Control', 'no-store, private');
    const { refreshToken: _refreshToken, sessionId: _sessionId, ...safeResponse } = result;
    return safeResponse;
  }

  @Public()
  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Req() request: ActorRequest,
    @Res({ passthrough: true }) response: CookieResponse,
  ) {
    return this.publishTokenPair(
      await this.auth.login(dto.username, dto.password, request),
      response,
    );
  }

  @Public()
  @Post('refresh')
  async refresh(
    @Req() request: ActorRequest,
    @Res({ passthrough: true }) response: CookieResponse,
  ) {
    const credentials = readRefreshCookie(request);
    return this.publishTokenPair(
      await this.auth.refresh(credentials.sessionId, credentials.token, request),
      response,
    );
  }

  @Public()
  @Post('dev/customer-token')
  mockCustomerToken(@Body() dto: MockCustomerTokenDto) {
    return this.auth.mockCustomerToken(dto.customerId);
  }

  @Authenticated()
  @ApiBearerAuth()
  @Get('me')
  me(@CurrentActor() actor: ActorContext) {
    return this.auth.me(actor);
  }

  @Authenticated()
  @PasswordChangeAllowed()
  @ApiBearerAuth()
  @Post('logout')
  async logout(
    @CurrentActor() actor: ActorContext,
    @Req() request: ActorRequest,
    @Res({ passthrough: true }) response: CookieResponse,
  ) {
    const result = await this.auth.logout(actor, request);
    response.setHeader('Set-Cookie', `crm_refresh=; ${cookieOptions(this.config, 0)}`);
    return result;
  }

  @Authenticated()
  @PasswordChangeAllowed()
  @ApiBearerAuth()
  @Post('password')
  async changePassword(
    @CurrentActor() actor: ActorContext,
    @Body() dto: ChangePasswordDto,
    @Req() request: ActorRequest,
    @Res({ passthrough: true }) response: CookieResponse,
  ) {
    return this.publishTokenPair(
      await this.auth.changePassword(actor, dto.currentPassword, dto.newPassword, request),
      response,
    );
  }
}
