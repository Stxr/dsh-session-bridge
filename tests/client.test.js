import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
const code = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');
function snapshot(value) { return { getSnapshot: () => value, subscribe: () => () => {} }; }
function harness(t, options = {}) {
  const opened = [];
  const effects = [];
  let module;
  let current = 'original';
  let navigations = 0;
  let resolveAck;
  const ack = new Promise(resolve => { resolveAck = resolve; });
  let polled = false;
  const request = { requestId: 'r1', sessionId: 'target', expiresAt: Date.now() + (options.ttl ?? 1000), deliveryToken: 'delivery' };
  const window = { location: { protocol: options.browser ? 'http:' : 'dsh-app:', hostname: options.browser ? '127.0.0.1' : 'app', pathname: options.pathname ?? '/' },
    __ModuleLoader__: { load: value => { module = value.factory(); } } };
  window.top = options.frame ? {} : window;
  const list = { phase: 'ready', byId: { target: { id: 'target', retainedBy: {} }, original: { id: 'original', retainedBy: { mainView: 1 } } } };
  const ctx = {
    connection: { state: snapshot('connected'), rpc: { call: async (_channel, endpoint, payload, signal) => {
      if (endpoint === 'authorize') return { ok: true, value: { status: options.superseded ? 'superseded' : 'authorized' } };
      if (endpoint === 'ack') { resolveAck(payload); return { ok: true, value: {} }; }
      if (endpoint === 'release') return { ok: true, value: {} };
      if (!polled) { polled = true; return { ok: true, value: { status: 'request', request } }; }
      return new Promise(resolve => {
        const done = () => resolve({ ok: true, value: { status: 'idle' } });
        signal.addEventListener('abort', done, { once: true });
        if (signal.aborted) done();
      });
    } } },
    sessions: { list: snapshot(list), retainInfo: () => snapshot({ retainedBy: { mainView: current === 'target' ? 1 : 0 } }),
      using: async (_target, { signal }, callback) => {
        if (options.load) await options.load(signal);
        signal.throwIfAborted();
        return callback({ ready: Promise.resolve({ session: snapshot({ openState: options.loadError ? 'error' : 'open', removed: false }) }) });
      } },
    workspaces: { list: snapshot({ phase: 'ready', archivedSessionIds: options.archived ? ['target'] : [] }) },
    uiWorkspace: { openSession: id => { opened.push(id); current = id; list.byId.original.retainedBy.mainView = 0; list.byId.target.retainedBy.mainView = 1; } },
    layout: { beginNavigation: () => { navigations++; } },
    effect: effect => { effects.push(effect()); },
  };
  vm.runInNewContext(code, { window, crypto: webcrypto, AbortController, AbortSignal, setTimeout, clearTimeout, console });
  module.apply(ctx);
  t.after(() => effects.forEach(dispose => dispose()));
  return { opened, ack, navigations: () => navigations, effects };
}

test('opens loaded history, cancels startup navigation, and confirms exact main selection', async t => {
  const h = harness(t);
  assert.equal((await h.ack).status, 'opened');
  assert.deepEqual(h.opened, ['target']);
  assert.equal(h.navigations(), 1);
});

test('does not navigate archived sessions', async t => {
  const h = harness(t, { archived: true });
  assert.equal((await h.ack).status, 'archived');
  assert.deepEqual(h.opened, []);
});

test('does not navigate failed or superseded loads', async t => {
  for (const options of [{ loadError: true }, { superseded: true }]) {
    const h = harness(t, options);
    assert.notEqual((await h.ack).status, 'opened');
    assert.deepEqual(h.opened, []);
  }
});

test('expiry during history loading never produces late navigation', async t => {
  const h = harness(t, { ttl: 25, load: signal => new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })) });
  assert.equal((await h.ack).status, 'timeout');
  assert.deepEqual(h.opened, []);
});

test('browser tabs never start polling or register a consumer', t => {
  const h = harness(t, { browser: true });
  assert.equal(h.effects.length, 0);
  assert.deepEqual(h.opened, []);
});

test('embedded frames and desktop welcome pages never consume navigation', t => {
  for (const options of [{ frame: true }, { pathname: '/welcome.html' }]) {
    const h = harness(t, options);
    assert.equal(h.effects.length, 0);
    assert.deepEqual(h.opened, []);
  }
});

test('desktop index.html remains a supported consumer entry', async t => {
  const h = harness(t, { pathname: '/index.html' });
  assert.equal((await h.ack).status, 'opened');
  assert.deepEqual(h.opened, ['target']);
});
