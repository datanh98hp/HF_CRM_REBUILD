import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AccessTokenService } from './access-token.service.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { PasswordHasherService } from './password-hasher.service.js';
import { LoginRateLimitService } from './login-rate-limit.service.js';
import { PermissionGuard } from '../access-control/permission.guard.js';

@Global()
@Module({
  controllers: [AuthController],
  providers: [
    AccessTokenService,
    PasswordHasherService,
    LoginRateLimitService,
    AuthService,
    JwtAuthGuard,
    { provide: APP_GUARD, useExisting: JwtAuthGuard },
    { provide: APP_GUARD, useExisting: PermissionGuard },
  ],
  exports: [AuthService, AccessTokenService, PasswordHasherService],
})
export class AuthModule {}
