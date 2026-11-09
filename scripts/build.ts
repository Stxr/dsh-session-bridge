import { build } from 'esbuild';
import type { BuildOptions } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PLUGIN_NAME } from '../src/shared/protocol.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const generated = '// Generated from TypeScript by pnpm build. Edit src/, not this file.';
const common: BuildOptions = {
  absWorkingDir: root,
  bundle: true,
  charset: 'utf8',
  minify: false,
  legalComments: 'inline',
  logLevel: 'info',
};

await build({
  ...common,
  entryPoints: { index: 'src/host/index.ts', bridge: 'src/host/public.ts' },
  outdir: 'lib',
  platform: 'node',
  format: 'esm',
  target: 'node24',
  banner: { js: generated },
});

// DSH materializes this factory once; all browser code stays inside the closure.
// No external runtime packages, ESM loader, or build-time dependency is needed.
await build({
  ...common,
  entryPoints: ['src/client/index.ts'],
  outfile: 'lib/client.js',
  platform: 'browser',
  format: 'cjs',
  target: 'es2023',
  banner: { js: `${generated}\nwindow.__ModuleLoader__.load({\n  id: ${JSON.stringify(PLUGIN_NAME)},\n  factory() {\n    const module = { exports: {} };` },
  footer: { js: '    return module.exports;\n  }\n});' },
});

execFileSync(process.execPath, [
  fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url)),
  '-p', 'tsconfig.build.json',
], { cwd: root, stdio: 'inherit' });
