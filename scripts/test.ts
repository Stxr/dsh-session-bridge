import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Always test the freshly compiled installable artifacts, including ModuleLoader.
await import('./build.js');
const root = fileURLToPath(new URL('..', import.meta.url));
const files = (await readdir(new URL('../tests', import.meta.url)))
  .filter(name => name.endsWith('.test.js')).sort().map(name => `tests/${name}`);
const child = spawn(process.execPath, ['--test', ...files], { cwd: root, stdio: 'inherit' });
process.exitCode = await new Promise<number>((resolve, reject) => {
  child.once('error', reject);
  child.once('exit', code => resolve(code ?? 1));
});
