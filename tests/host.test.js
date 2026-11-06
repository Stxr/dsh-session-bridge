import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, statSync, existsSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { apply } from '../index.js';
import { CHANNEL, OPEN_PATH, STATUS_PATH } from '../bridge.js';

test('desktop profileContext publishes private discovery; HTTP uses independent auth and exact acknowledgement', async t => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'huantai-bridge-test-')));
  const routes = new Map();
  const cleanup = [];
  const server = createServer((req, res) => {
    const route = routes.get(req.url) ?? [...routes.values()].find(route => route.kind === 'prefix' && req.url.startsWith(route.path + '/'));
    if (route) void route.handler(req, res);
    else { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  t.after(async () => {
    cleanup.forEach(dispose => dispose());
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    assert.equal(dirname(home), realpathSync(tmpdir()));
    assert.ok(basename(home).startsWith('huantai-bridge-test-'));
    rmSync(home, { recursive: true });
  });
  const ctx = {
    get: key => key === 'profileContext' ? { name: 'desktop', home } : undefined,
    effect: callback => cleanup.push(callback()),
    webServer: { getOrigin: () => origin, register: route => { routes.set(route.path, route); return () => routes.delete(route.path); } },
    connection: { admit: req => req.headers['x-fixture-cookie'] === 'owner'
      ? { peer: { id: 'owner', principal: { kind: 'owner' } } } : { rejection: 401 } },
    sessions: { get: id => id === 'foreign-live' ? { header: { id } } : undefined },
    sessionPersistence: { stat: async id => id === 'known' ? { header: { id }, location: { path: join(home, 'sessions', id, 'session.jsonl') } }
      : id === 'foreign-live' ? { header: { id }, location: { path: '/other-dsh/sessions/foreign-live/session.jsonl' } } : undefined },
  };
  apply(ctx);
  const path = join(home, 'huantai-bridge', 'desktop.json');
  const discovery = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.equal(statSync(join(home, 'huantai-bridge')).mode & 0o777, 0o700);
  assert.equal(discovery.endpoint, origin + OPEN_PATH);
  assert.equal((await fetch(origin + STATUS_PATH)).status, 401);
  const headers = { authorization: 'Bearer ' + discovery.token, 'content-type': 'application/json' };
  assert.equal((await fetch(origin + STATUS_PATH, { headers: { ...headers, origin: 'http://attacker' } })).status, 401);
  assert.equal((await fetch(origin + CHANNEL + '/poll', { method: 'POST', headers, body: '{}' })).status, 401);
  const rpc = async (method, payload) => {
    const response = await fetch(origin + CHANNEL + '/' + method, { method: 'POST', headers: { ...headers, 'x-fixture-cookie': 'owner' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'rpc-one', method, payload }) });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.type, 'server-response');
    assert.equal(result.rpcId, 'rpc-one');
    return result.result;
  };
  const client = { clientId: 'desktop-main', page: 'dsh-app://app/' };
  const poll = rpc('poll', client);
  for (let attempt = 0; attempt < 20; attempt++) {
    if ((await (await fetch(origin + STATUS_PATH, { headers })).json()).ready) break;
  }
  assert.equal((await (await fetch(origin + STATUS_PATH, { headers })).json()).ready, true);
  const body = { protocolVersion: 1, instanceId: discovery.instanceId, dataDir: home, requestId: 'http-request', sessionId: 'known', expiresAt: Date.now() + 1000 };
  const responsePromise = fetch(discovery.endpoint, { method: 'POST', headers, body: JSON.stringify(body) });
  const delivery = (await poll).value.request;
  await rpc('ack', { ...client, ...delivery, status: 'opened', selectedSessionId: 'known' });
  const response = await responsePromise;
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, 'opened');
  const absent = await fetch(discovery.endpoint, { method: 'POST', headers, body: JSON.stringify({ ...body, requestId: 'absent', sessionId: 'missing' }) });
  assert.equal((await absent.json()).status, 'not-found');
  const foreign = await fetch(discovery.endpoint, { method: 'POST', headers, body: JSON.stringify({ ...body, requestId: 'foreign', sessionId: 'foreign-live' }) });
  assert.equal(foreign.status, 409);
  assert.equal((await foreign.json()).status, 'instance-mismatch');
  const status = await (await fetch(origin + STATUS_PATH, { headers })).json();
  assert.equal(status.selectedSessionId, 'known');
  cleanup.forEach(dispose => dispose());
  assert.equal(existsSync(path), false);
  assert.equal(routes.size, 0);
});

test('a web profile cannot publish or consume desktop discovery', () => {
  let effect = false;
  apply({ get: () => ({ name: 'web' }), effect: () => { effect = true; } });
  assert.equal(effect, false);
});
