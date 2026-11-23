import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import dotenv from 'dotenv';

const repositoryRoot = resolve(import.meta.dirname, '..');
const envFile = resolve(repositoryRoot, '.env.prod.local');
const exampleFile = resolve(repositoryRoot, '.env.prod.local.example');

if (!existsSync(envFile)) {
  let content = readFileSync(exampleFile, 'utf8');
  content = content
    .replace('CHANGE_ME_LOCAL_POSTGRES_PASSWORD', randomBytes(24).toString('base64url'))
    .replace('CHANGE_ME_LOCAL_AUTH_ACCESS_TOKEN_SECRET_32_CHARS', randomBytes(48).toString('base64url'))
    .replace('CHANGE_ME_LOCAL_BOOTSTRAP_PASSWORD', randomBytes(24).toString('base64url'))
    .replace('CHANGE_ME_LOCAL_32_BYTE_BASE64_KEY', randomBytes(32).toString('base64'));
  writeFileSync(envFile, content, { encoding: 'utf8', mode: 0o600 });
}

const values = dotenv.parse(readFileSync(envFile));
for (const key of ['POSTGRES_PASSWORD', 'AUTH_ACCESS_TOKEN_SECRET', 'BOOTSTRAP_ADMIN_PASSWORD', 'BACKUP_ENCRYPTION_KEY']) {
  if (!values[key] || values[key].includes('CHANGE_ME')) {
    throw new Error(`Production-local secret ${key} is missing or still a placeholder.`);
  }
}

if (!values.WEB_ORIGINS?.includes('https://localhost') ||
    values.NEXT_PUBLIC_API_BASE_URL !== 'https://localhost') {
  throw new Error('Production-local HTTPS values must use https://localhost for web and API.');
}

function parseReplicaCount(key, fallback) {
  const count = Number(values[key] ?? fallback);
  if (!Number.isInteger(count) || count < 1 || count > 20) {
    throw new Error(`${key} must be an integer between 1 and 20.`);
  }
  return count;
}

const apiReplicas = parseReplicaCount('API_REPLICAS', 2);
const workerReplicas = parseReplicaCount('WORKER_REPLICAS', 2);
const args = [
  'compose',
  '--env-file', envFile,
  '-f', resolve(repositoryRoot, 'docker-compose.yml'),
  '-f', resolve(repositoryRoot, 'docker-compose.prod.yml'),
  '-f', resolve(repositoryRoot, 'docker-compose.prod-local.yml'),
  'up',
  '--build',
  '--scale', `api=${apiReplicas}`,
  '--scale', `worker=${workerReplicas}`,
  '-d',
];

const result = spawnSync('docker', args, {
  cwd: repositoryRoot,
  stdio: 'inherit',
  windowsHide: true,
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
