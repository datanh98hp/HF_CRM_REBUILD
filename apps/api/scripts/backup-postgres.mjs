import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { readFile, mkdir, rename, rm } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { encryptBackupStream, parseBackupKey } from './backup-crypto.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

function parseArguments(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (!name.startsWith('--') || !argv[index + 1] || argv[index + 1].startsWith('--')) {
      throw new Error('Expected --environment <dev|test|prod> and --project-name <compose-project>');
    }
    result[name.slice(2)] = argv[index + 1];
    index += 1;
  }
  return result;
}

function composeArguments(environment, projectName, envFile) {
  return [
    'compose',
    '--project-name', projectName,
    '--env-file', envFile,
    '-f', resolve(repositoryRoot, 'docker-compose.yml'),
    '-f', resolve(repositoryRoot, `docker-compose.${environment}.yml`),
  ];
}

function assertComposeTarget(composeArgs, expectedDatabase) {
  const result = spawnSync('docker', [
    ...composeArgs,
    'exec', '-T', 'postgres', 'sh', '-c', 'printf "%s" "$POSTGRES_DB"',
  ], { encoding: 'utf8', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('Cannot reach the selected Compose PostgreSQL service');
  if (result.stdout.trim() !== expectedDatabase) {
    throw new Error('Compose PostgreSQL database does not match the selected environment file');
  }
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  const environment = args.environment;
  const projectName = args['project-name'];
  if (!['dev', 'test', 'prod'].includes(environment) || !projectName || !/^[a-z0-9][a-z0-9_-]*$/i.test(projectName)) {
    throw new Error('Specify a valid --environment and --project-name');
  }

  const envFile = resolve(repositoryRoot, `.env.${environment}`);
  const environmentValues = dotenv.parse(await readFile(envFile));
  dotenv.config({ path: envFile });
  const expectedDatabase = process.env.POSTGRES_DB || environmentValues.POSTGRES_DB;
  if (!expectedDatabase) throw new Error('POSTGRES_DB is required in the selected environment');
  const key = parseBackupKey(process.env.BACKUP_ENCRYPTION_KEY?.trim() || environmentValues.BACKUP_ENCRYPTION_KEY);
  const composeArgs = composeArguments(environment, projectName, envFile);
  assertComposeTarget(composeArgs, expectedDatabase);

  const backupDirectory = resolve(repositoryRoot, 'backup');
  await mkdir(backupDirectory, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputPath = join(backupDirectory, `finance-crm-${environment}-${timestamp}.dump.enc`);
  const partialPath = `${outputPath}.partial`;
  const dump = spawn('docker', [
    ...composeArgs,
    'exec', '-T', 'postgres', 'sh', '-c',
    'exec pg_dump --format=custom --no-owner --no-acl -U "$POSTGRES_USER" "$POSTGRES_DB"',
  ], { stdio: ['ignore', 'pipe', 'inherit'], windowsHide: true });
  const dumpExit = new Promise((resolveExit, rejectExit) => {
    dump.once('error', rejectExit);
    dump.once('close', (code, signal) => resolveExit({ code, signal }));
  });

  try {
    const output = createWriteStream(partialPath, { flags: 'wx', mode: 0o600 });
    await encryptBackupStream(dump.stdout, output, key);
    const result = await dumpExit;
    if (result.code !== 0) throw new Error(`pg_dump failed (exit ${result.code ?? result.signal})`);
    await rename(partialPath, outputPath);
  } catch (error) {
    await rm(partialPath, { force: true });
    throw error;
  }

  process.stdout.write(`Encrypted database backup written to ${outputPath}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Database backup failed'}\n`);
  process.exitCode = 1;
});
