import type { IncomingMessage, ServerResponse } from 'node:http';
import { CHANNEL, ID_PATTERN, isRecord, isRpcEndpoint, OPEN_PATH, STATUS_PATH } from '../shared/protocol.js';
import { authorized } from './auth.js';
import type { Bridge } from './bridge.js';
import type { HostContext } from './context.js';

function json(res: ServerResponse, code: number, value: unknown): void {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(JSON.stringify(value));
}

async function bodyOf(req: IncomingMessage): Promise<unknown> {
  if (!/^application\/json(?:\s*;.*)?$/i.test(req.headers['content-type'] ?? '')) throw new Error('content-type');
  if (Number(req.headers['content-length'] ?? 0) > 8192) throw new Error('too-large');
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const value of req) {
    // Unencoded IncomingMessage streams yield Buffers; the route never calls setEncoding.
    const chunk = value as Buffer;
    bytes += chunk.length;
    if (bytes > 8192) throw new Error('too-large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

/** Own the two external token routes and the admitted DSH RPC-envelope route. */
export function registerRoutes(ctx: HostContext, bridge: Bridge, token: string, origin: string): void {
  const { webServer, connection } = ctx;
  ctx.effect(() => webServer.register({ kind: 'exact', path: OPEN_PATH, handler: async (req, res) => {
    if (!authorized(req, token, origin)) { json(res, 401, { status: 'unauthorized' }); return; }
    if (req.method !== 'POST') { res.setHeader('allow', 'POST'); json(res, 405, { status: 'method-not-allowed' }); return; }
    const readTimer = setTimeout(() => req.destroy(), 3000);
    let body: unknown;
    try { body = await bodyOf(req); }
    catch { json(res, 400, { protocolVersion: 1, status: 'invalid-request' }); return; }
    finally { clearTimeout(readTimer); }
    const result = await bridge.submit(body);
    json(res, result.status === 'not-ready' ? 503 : result.status === 'invalid-request' ? 400
      : result.status === 'instance-mismatch' ? 409 : 200, result);
  } }));
  ctx.effect(() => webServer.register({ kind: 'exact', path: STATUS_PATH, handler: (req, res) => {
    if (!authorized(req, token, origin)) { json(res, 401, { status: 'unauthorized' }); return; }
    if (req.method !== 'GET') { res.setHeader('allow', 'GET'); json(res, 405, { status: 'method-not-allowed' }); return; }
    json(res, 200, bridge.status());
  } }));
  // DSH 0.2.2-rc.1 rpc.handle delegates through a Context without webServer injection.
  // Adapt its published envelope on our owned route; Connection still admits every page.
  ctx.effect(() => webServer.register({ kind: 'prefix', path: CHANNEL, handler: async (req, res) => {
    const admission = connection.admit(req);
    if ('rejection' in admission) { json(res, admission.rejection, { status: 'unauthorized' }); return; }
    if (admission.peer.principal.kind !== 'owner') { json(res, 403, { status: 'forbidden' }); return; }
    const endpoint = req.url?.slice(CHANNEL.length + 1);
    if (req.method !== 'POST' || !isRpcEndpoint(endpoint)) { json(res, 404, { status: 'not-found' }); return; }
    const readTimer = setTimeout(() => req.destroy(), 3000);
    let envelope: unknown;
    try { envelope = await bodyOf(req); }
    catch { json(res, 400, { status: 'invalid-request' }); return; }
    finally { clearTimeout(readTimer); }
    if (!isRecord(envelope) || envelope.type !== 'client-request' || envelope.method !== endpoint
      || typeof envelope.rpcId !== 'string' || !ID_PATTERN.test(envelope.rpcId)) {
      json(res, 400, { status: 'invalid-request' }); return;
    }
    const controller = new AbortController();
    const abort = () => controller.abort();
    res.once('close', abort);
    try {
      const value = await bridge.rpc(endpoint, envelope.payload, controller.signal, admission.peer.id);
      json(res, 200, { type: 'server-response', rpcId: envelope.rpcId, result: { ok: true, value } });
    } finally { res.removeListener('close', abort); }
  } }));
}
