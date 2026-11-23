import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import dotenv from 'dotenv';

const repositoryRoot = resolve(import.meta.dirname, '..');
const envFile = resolve(repositoryRoot, '.env.prod');
let values;

try {
  values = dotenv.parse(readFileSync(envFile));
} catch {
  throw new Error('Missing .env.prod. Copy .env.prod.example and configure production secrets before starting.');
}

for (const key of [
  'POSTGRES_PASSWORD',
  'AUTH_ACCESS_TOKEN_SECRET',
  'BOOTSTRAP_ADMIN_PASSWORD',
  'BACKUP_ENCRYPTION_KEY',
]) {
  if (!values[key] || values[key].includes('SET_IN_SECRET_MANAGER')) {
    throw new Error(`Production secret ${key} is missing or still uses a placeholder.`);
  }
}

for (const key of ['WEB_DOMAIN', 'API_DOMAIN']) {
  const value = values[key]?.trim();
  if (!value) throw new Error(`Production domain ${key} is required.`);
  if (value.includes('example.com')) {
    throw new Error(`Production domain ${key} is still a placeholder; configure real DNS before starting.`);
  }
}

if (!/^https:\/\//.test(values.WEB_ORIGINS ?? '') || !/^https:\/\//.test(values.NEXT_PUBLIC_API_BASE_URL ?? '')) {
  throw new Error('Production WEB_ORIGINS and NEXT_PUBLIC_API_BASE_URL must use HTTPS.');
}

function parseReplicaCount(key, fallback) {
  const raw = values[key] ?? String(fallback);
  const count = Number(raw);
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
