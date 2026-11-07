import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const apiDirectory = resolve(scriptDirectory, '..');
const npmCli = process.env.npm_execpath;

function runNpmScript(name) {
  const result = npmCli
    ? spawnSync(process.execPath, [npmCli, 'run', name], { cwd: apiDirectory, stdio: 'inherit' })
    : spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', name], {
        cwd: apiDirectory,
        stdio: 'inherit',
        shell: process.platform === 'win32',
      });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

// The production Docker image already contains the generated client and compiled seed module.
// Local development builds these artifacts first, independent of the developer's OS.
if (process.env.NODE_ENV !== 'production' && process.env.CRM_PREBUILT_RUNTIME !== 'true') {
  runNpmScript('db:generate');
  runNpmScript('build');
}

const seed = spawnSync(process.execPath, [resolve(scriptDirectory, 'seed-access-control.mjs')], {
  cwd: apiDirectory,
  stdio: 'inherit',
});
if (seed.error) throw seed.error;
process.exit(seed.status ?? 1);
