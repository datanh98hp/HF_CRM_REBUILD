import { spawn, spawnSync } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { pipeline } from 'node:stream/promises';
import { decryptBackupStream, parseBackupKey } from './backup-crypto.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

function parseArguments(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (name === '--confirm-empty-database') {
      result.confirmEmptyDatabase = true;
      continue;
    }
    if (!name.startsWith('--') || !argv[index + 1] || argv[index + 1].startsWith('--')) {
      throw new Error('Expected --environment, --project-name, --file, --target-database, and --confirm-empty-database');
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
  const targetDatabase = args['target-database'];
  if (!['dev', 'test', 'prod'].includes(environment) || !projectName ||
      !/^[a-z0-9][a-z0-9_-]*$/i.test(projectName) ||
      !targetDatabase || !/^[a-z0-9_]+$/i.test(targetDatabase) || !args.confirmEmptyDatabase) {
    throw new Error('Specify a valid environment/project, target database, and --confirm-empty-database');
  }

  const backupDirectory = resolve(repositoryRoot, 'backup');
  const backupPath = resolve(repositoryRoot, args.file ?? '');
  const backupRelativePath = relative(backupDirectory, backupPath);
  if (!args.file || backupRelativePath.startsWith(`..${sep}`) || backupRelativePath === '..' || backupRelativePath === '') {
    throw new Error('The backup file must be inside the repository-root backup directory');
  }

  const envFile = resolve(repositoryRoot, `.env.${environment}`);
  const environmentValues = dotenv.parse(await readFile(envFile));
  dotenv.config({ path: envFile });
  const expectedDatabase = process.env.POSTGRES_DB || environmentValues.POSTGRES_DB;
  const databaseUser = process.env.POSTGRES_USER || environmentValues.POSTGRES_USER;
  if (!expectedDatabase || !databaseUser) throw new Error('POSTGRES_DB and POSTGRES_USER are required in the selected environment');
  if (targetDatabase === expectedDatabase) throw new Error('Restore target must differ from the selected source database');
  const key = parseBackupKey(process.env.BACKUP_ENCRYPTION_KEY?.trim() || environmentValues.BACKUP_ENCRYPTION_KEY);
  const composeArgs = composeArguments(environment, projectName, envFile);
  assertComposeTarget(composeArgs, expectedDatabase);

  const created = spawnSync('docker', [
    ...composeArgs, 'exec', '-T', 'postgres', 'createdb', '-U', databaseUser, targetDatabase,
  ], { stdio: 'inherit', windowsHide: true });
  if (created.error) throw created.error;
  if (created.status !== 0) throw new Error('Could not create an empty restore target database; no existing database was overwritten');

  const restore = spawn('docker', [
    ...composeArgs,
    'exec', '-T', 'postgres', 'sh', '-c',
    'exec pg_restore --exit-on-error --no-owner --no-acl --dbname="$1"', 'restore', targetDatabase,
  ], { stdio: ['pipe', 'inherit', 'inherit'], windowsHide: true });
  const restoreExit = new Promise((resolveExit, rejectExit) => {
    restore.once('error', rejectExit);
    restore.once('close', (code, signal) => resolveExit({ code, signal }));
  });
  await pipeline(decryptBackupStream(createReadStream(backupPath), key), restore.stdin);
  const result = await restoreExit;
  if (result.code !== 0) throw new Error(`pg_restore failed (exit ${result.code ?? result.signal}); the target database was left in place for inspection`);
  process.stdout.write(`Backup restored to empty database ${targetDatabase}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Database restore failed'}\n`);
  process.exitCode = 1;
});
