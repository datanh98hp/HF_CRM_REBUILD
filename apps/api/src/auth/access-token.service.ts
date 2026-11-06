import { Injectable, UnauthorizedException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { RuntimeConfigService } from '../runtime-config/runtime-config.service.js';
import { ActorType } from '../common/actor-context.js';

export interface AccessTokenPayload {
  sub: string;
  sid?: string;
  actorType: ActorType;
  mockCustomer?: boolean;
  iat: number;
  exp: number;
  iss: 'finance-crm';
  aud: 'finance-crm-api';
}

function encode(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

@Injectable()
export class AccessTokenService {
  constructor(private readonly config: RuntimeConfigService) {}

  sign(input: Pick<AccessTokenPayload, 'sub' | 'sid' | 'actorType' | 'mockCustomer'>): string {
    const now = Math.floor(Date.now() / 1000);
    const header = encode({ alg: 'HS256', typ: 'JWT' });
    const payload = encode({
      ...input,
      iat: now,
      exp: now + this.config.value.authAccessTokenTtlSeconds,
      iss: 'finance-crm',
      aud: 'finance-crm-api',
    });
    const body = `${header}.${payload}`;
    return `${body}.${this.signature(body)}`;
  }

  verify(token: string): AccessTokenPayload {
    const parts = token.split('.');
    if (parts.length !== 3) throw new UnauthorizedException('Invalid access token');
    const [headerPart, payloadPart, signaturePart] = parts;
    const expected = Buffer.from(this.signature(`${headerPart}.${payloadPart}`));
    const actual = Buffer.from(signaturePart);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      throw new UnauthorizedException('Invalid access token');
    }

    try {
      const header = JSON.parse(Buffer.from(headerPart, 'base64url').toString('utf8')) as { alg?: string; typ?: string };
      const payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8')) as AccessTokenPayload;
      const now = Math.floor(Date.now() / 1000);
      if (
        header.alg !== 'HS256' || header.typ !== 'JWT' ||
        payload.iss !== 'finance-crm' || payload.aud !== 'finance-crm-api' ||
        !Number.isInteger(payload.exp) || payload.exp <= now ||
        !payload.sub || !['STAFF', 'CUSTOMER'].includes(payload.actorType)
      ) throw new Error('Invalid claims');
      return payload;
    } catch {
      throw new UnauthorizedException('Invalid access token');
    }
  }

  private signature(body: string): string {
    return createHmac('sha256', this.config.value.authAccessTokenSecret)
      .update(body)
      .digest('base64url');
  }
}
