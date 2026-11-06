import { Injectable } from '@nestjs/common';
import dotenv from 'dotenv';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type RuntimeEnvironment = 'development' | 'test' | 'production';

export interface RuntimeConfig {
  nodeEnv: RuntimeEnvironment;
  apiPort: number;
  databaseUrl: string;
  redisUrl: string;
  workerConcurrency: number;
  authAccessTokenSecret: string;
  authAccessTokenTtlSeconds: number;
  authRefreshTokenTtlDays: number;
}

const apiDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const repositoryDirectory = resolve(apiDirectory, '../..');

function loadEnvironmentFiles(): void {
  for (const envPath of [
    resolve(apiDirectory, '.env'),
    resolve(repositoryDirectory, '.env'),
  ]) {
    if (existsSync(envPath)) dotenv.config({ path: envPath });
  }
}

function parsePort(name: string, raw: string | undefined, fallback: number): number {
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new Error(`${name} must be an integer between 1 and 65535`);
  }
  return value;
}

function parseConcurrency(raw: string | undefined): number {
  const value = raw === undefined ? 5 : Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 50) {
    throw new Error('WORKER_CONCURRENCY must be an integer between 1 and 50');
  }
  return value;
}

function parseBoundedInteger(
  name: string,
  raw: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function parseUrl(name: string, raw: string | undefined, protocols: string[]): string {
  if (!raw) throw new Error(`${name} is required`);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }
  if (!protocols.includes(url.protocol) || !url.hostname) {
    throw new Error(`${name} must use one of: ${protocols.join(', ')}`);
  }
  return url.toString();
}

function loadRuntimeConfig(): RuntimeConfig {
  loadEnvironmentFiles();

  const rawNodeEnv = process.env.NODE_ENV ?? 'development';
  if (!['development', 'test', 'production'].includes(rawNodeEnv)) {
    throw new Error('NODE_ENV must be development, test, or production');
  }

  const authAccessTokenSecret = process.env.AUTH_ACCESS_TOKEN_SECRET;
  if (
    !authAccessTokenSecret || authAccessTokenSecret.length < 32 ||
    /replace|change-me|example/i.test(authAccessTokenSecret)
  ) {
    throw new Error('AUTH_ACCESS_TOKEN_SECRET must contain at least 32 characters');
  }

  return {
    nodeEnv: rawNodeEnv as RuntimeEnvironment,
    apiPort: parsePort('API_PORT', process.env.API_PORT, 3001),
    databaseUrl: parseUrl('DATABASE_URL', process.env.DATABASE_URL, [
      'postgres:',
      'postgresql:',
    ]),
    redisUrl: parseUrl('REDIS_URL', process.env.REDIS_URL, ['redis:', 'rediss:']),
    workerConcurrency: parseConcurrency(process.env.WORKER_CONCURRENCY),
    authAccessTokenSecret,
    authAccessTokenTtlSeconds: parseBoundedInteger(
      'AUTH_ACCESS_TOKEN_TTL_SECONDS',
      process.env.AUTH_ACCESS_TOKEN_TTL_SECONDS,
      900,
      60,
      3_600,
    ),
    authRefreshTokenTtlDays: parseBoundedInteger(
      'AUTH_REFRESH_TOKEN_TTL_DAYS',
      process.env.AUTH_REFRESH_TOKEN_TTL_DAYS,
      30,
      1,
      90,
    ),
  };
}

@Injectable()
export class RuntimeConfigService {
  readonly value = loadRuntimeConfig();
}
