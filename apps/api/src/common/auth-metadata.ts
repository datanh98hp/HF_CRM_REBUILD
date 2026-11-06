import { SetMetadata } from '@nestjs/common';
import { AccessScope } from '../generated/prisma/client.js';

export const PUBLIC_ROUTE = 'auth:public';
export const AUTHENTICATED_ROUTE = 'auth:authenticated';
export const REQUIRED_PERMISSION = 'auth:permission';
export const PASSWORD_CHANGE_ROUTE = 'auth:password-change';

export function Public(): MethodDecorator & ClassDecorator {
  return SetMetadata(PUBLIC_ROUTE, true);
}

export function Authenticated(): MethodDecorator & ClassDecorator {
  return SetMetadata(AUTHENTICATED_ROUTE, true);
}

export function RequirePermission(
  key: string,
  scope?: AccessScope,
): MethodDecorator & ClassDecorator {
  return SetMetadata(REQUIRED_PERMISSION, { key, scope });
}

export function PasswordChangeAllowed(): MethodDecorator & ClassDecorator {
  return SetMetadata(PASSWORD_CHANGE_ROUTE, true);
}
