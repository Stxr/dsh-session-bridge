import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// Exercise the same committed artifacts that Git installations load, not TS imports.
test('package exports resolve compiled Host, broker, declarations and lazy ModuleLoader Client', async () => {
  const root = new URL('../', import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
  assert.equal(manifest.version, '0.1.1');
  assert.equal(manifest.engines.dsh, '0.2.2-rc.1');
  assert.equal(manifest.dependencies, undefined);
  assert.equal(manifest.scripts.prepare, undefined);
  assert.equal(manifest.scripts.postinstall, undefined);
  const host = await import(new URL(manifest.exports['.'].default, root));
  assert.equal(typeof host.apply, 'function');
  for (const entry of ['.', './client', './bridge']) {
    const declaration = await readFile(new URL(manifest.exports[entry].types, root), 'utf8');
    assert.ok(declaration.includes('export'));
  }
  const broker = await import(new URL(manifest.exports['./bridge'].default, root));
  assert.equal(typeof broker.Bridge, 'function');
  const source = await readFile(new URL(manifest.exports['./client'].default, root), 'utf8');
  let registration;
  // No Host services, require(), browser location or timers exist during registration.
  vm.runInNewContext(source, { window: { __ModuleLoader__: { load: value => { registration = value; } } } });
  assert.equal(registration.id, manifest.name);
  const client = registration.factory();
  assert.equal(typeof client.apply, 'function');
  assert.deepEqual(Array.from(client.inject), ['connection', 'uiWorkspace', 'sessions', 'workspaces', 'layout']);
});
