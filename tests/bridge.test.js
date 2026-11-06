import test from 'node:test';
import assert from 'node:assert/strict';
import { Bridge, authorized, validRequest } from '../bridge.js';

const instanceId = 'instance-one';
const dataDir = '/test/.dsh';
function request(extra = {}) {
  return { protocolVersion: 1, instanceId, dataDir, requestId: 'request-one', sessionId: 'session-one', expiresAt: Date.now() + 1000, ...extra };
}
function setup(t, preflight = async () => undefined) {
  const bridge = new Bridge({ instanceId, dataDir, preflight });
  const controller = new AbortController();
  t.after(() => { bridge.dispose(); controller.abort(); });
  const client = { clientId: 'desktop-one', page: 'dsh-app://app/', selectedSessionId: 'original' };
  const poll = () => bridge.rpc('poll', client, controller.signal, 'owner');
  return { bridge, controller, client, poll };
}

test('validates identity, exact fields, expiration, and safe session ids', () => {
  assert.equal(validRequest(request(), instanceId, dataDir), undefined);
  for (const body of [request({ sessionId: '../escape' }), request({ protocolVersion: 2 }), request({ extra: true }), request({ expiresAt: Date.now() + 30000 }), request({ sessionId: 123 })]) {
    assert.equal(validRequest(body, instanceId, dataDir), 'invalid-request');
  }
  assert.equal(validRequest(request({ dataDir: '/other' }), instanceId, dataDir), 'instance-mismatch');
  assert.equal(validRequest(request({ expiresAt: Date.now() - 1 }), instanceId, dataDir), 'timeout');
});

test('authenticates bearer token and rejects browser origins, remote peers and rebinding', () => {
  const req = { headers: { host: '127.0.0.1:9999', authorization: 'Bearer private' }, socket: { remoteAddress: '127.0.0.1' } };
  assert.equal(authorized(req, 'private', 'http://127.0.0.1:9999'), true);
  assert.equal(authorized({ ...req, headers: { ...req.headers, origin: 'http://attacker' } }, 'private', 'http://127.0.0.1:9999'), false);
  assert.equal(authorized({ ...req, headers: { ...req.headers, host: 'attacker:9999' } }, 'private', 'http://127.0.0.1:9999'), false);
  assert.equal(authorized({ ...req, socket: { remoteAddress: '192.0.2.1' } }, 'private', 'http://127.0.0.1:9999'), false);
  assert.equal(authorized(req, 'wrong', 'http://127.0.0.1:9999'), false);
});

test('reports not ready without an attached desktop consumer', async t => {
  const { bridge, controller } = setup(t);
  assert.equal((await bridge.submit(request())).status, 'not-ready');
  assert.equal((await bridge.rpc('poll', { clientId: 'browser', page: 'http://127.0.0.1/' }, controller.signal, 'owner')).status, 'not-ready');
});

test('waits for the exact acknowledged selection; retries never redeliver', async t => {
  const { bridge, client, poll, controller } = setup(t);
  const waiting = poll();
  const body = request();
  const result = bridge.submit(body);
  assert.equal(bridge.submit(body), result);
  const reordered = Object.fromEntries(Object.entries(body).reverse());
  assert.equal(bridge.submit(reordered), result);
  const delivery = await waiting;
  assert.equal(delivery.request.sessionId, body.sessionId);
  const payload = { ...client, ...delivery.request };
  assert.equal((await bridge.rpc('authorize', payload, controller.signal, 'owner')).status, 'authorized');
  assert.equal((await bridge.rpc('ack', { ...payload, status: 'opened', selectedSessionId: 'wrong' }, controller.signal, 'owner')).status, 'invalid-request');
  const ack = await bridge.rpc('ack', { ...payload, status: 'opened', selectedSessionId: body.sessionId }, controller.signal, 'owner');
  assert.equal(ack.status, 'opened');
  assert.equal((await result).status, 'opened');
  assert.deepEqual(await bridge.submit(body), ack);
});

test('refuses nonexistent and subagent targets without delivery', async t => {
  const { bridge, poll } = setup(t, async () => 'unsupported-target');
  void poll();
  assert.equal((await bridge.submit(request())).status, 'unsupported-target');
});

test('supersedes delivered work before a late authorization', async t => {
  const { bridge, poll, client, controller } = setup(t);
  const waiting = poll();
  const first = bridge.submit(request());
  const delivery = await waiting;
  const nextPoll = poll();
  const second = bridge.submit(request({ requestId: 'request-two', sessionId: 'session-two' }));
  assert.equal((await first).status, 'superseded');
  assert.equal((await bridge.rpc('authorize', { ...client, ...delivery.request }, controller.signal, 'owner')).status, 'superseded');
  const next = await nextPoll;
  await bridge.rpc('ack', { ...client, ...next.request, status: 'archived' }, controller.signal, 'owner');
  assert.equal((await second).status, 'archived');
});

test('expires work while asynchronous preflight is still pending', async t => {
  let resolvePreflight;
  const { bridge, poll } = setup(t, () => new Promise(resolve => { resolvePreflight = resolve; }));
  void poll();
  const body = request({ expiresAt: Date.now() + 25 });
  assert.equal((await bridge.submit(body)).status, 'timeout');
  resolvePreflight();
  await Promise.resolve();
  assert.equal(bridge.active, undefined);
});

test('releases cancelled polls and refuses a competing page while leased', async t => {
  const { bridge, poll, controller } = setup(t);
  const waiting = poll();
  assert.equal((await bridge.rpc('poll', { clientId: 'desktop-two', page: 'dsh-app://app/' }, new AbortController().signal, 'owner')).status, 'busy');
  controller.abort();
  await waiting;
  assert.equal(bridge.status().ready, false);
  assert.equal((await bridge.submit(request())).status, 'not-ready');
});
