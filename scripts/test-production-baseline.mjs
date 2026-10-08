import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const tests = readdirSync(path.join(root, 'tests'))
  .filter(name => name.endsWith('.mjs')).sort().map(name => path.join('tests', name));
const result = spawnSync(process.execPath, ['--import', './scripts/register-loader.mjs', '--test', ...tests], {
  cwd: root, stdio: 'inherit',
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
