import { randomBytes, randomUUID } from 'node:crypto';
import { chmodSync, closeSync, constants, existsSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { authorized, Bridge, CHANNEL, OPEN_PATH, STATUS_PATH } from './bridge.js';

export const inject = ['webServer', 'connection', 'sessionPersistence', 'sessions', 'profileContext'];

function json(res, code, value) {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(JSON.stringify(value));
}

async function bodyOf(req) {
  if (!/^application\/json(?:\s*;.*)?$/i.test(req.headers['content-type'] ?? '')) throw new Error('content-type');
  if (Number(req.headers['content-length'] ?? 0) > 8192) throw new Error('too-large');
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 8192) throw new Error('too-large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export function apply(ctx) {
  // The desktop Host alone owns discovery; a web profile must never steal it.
  const profile = ctx.get('profileContext');
  if (profile?.name !== 'desktop') return;
  const root = profile.home || process.env.DSH_HOME || join(homedir(), '.dsh');
  if (!isAbsolute(root)) throw new Error('Huantai bridge requires an absolute DSH_HOME');
  const dataDir = realpathSync(root);
  const webServer = ctx.webServer;
  const connection = ctx.connection;
  const sessions = ctx.sessions;
  const persistence = ctx.sessionPersistence;
  const origin = webServer.getOrigin();
  if (new URL(origin).hostname !== '127.0.0.1' || new URL(origin).protocol !== 'http:') throw new Error('Huantai bridge requires a loopback HTTP Host');
  const instanceId = randomUUID();
  const token = randomBytes(32).toString('hex');
  const bridge = new Bridge({ instanceId, dataDir, preflight: async sessionId => {
    const live = sessions.get(sessionId);
    const stored = await persistence.stat(sessionId);
    const header = live?.header ?? stored?.header;
    if (!header) return 'not-found';
    if (header.origin === 'subagent') return 'unsupported-target';
    // Refuse a customized persistence root that disagrees with Huantai's scanned directory.
    if (stored?.location?.path && !resolve(stored.location.path).startsWith(join(dataDir, 'sessions') + '/')) return 'instance-mismatch';
  } });

  ctx.effect(() => {
    const directory = join(dataDir, 'huantai-bridge');
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (lstatSync(directory).isSymbolicLink() || realpathSync(directory) !== directory) throw new Error('Huantai discovery directory must not be a symlink');
    chmodSync(directory, 0o700);
    const discovery = join(directory, 'desktop.json');
    const temporary = join(directory, instanceId + '.tmp');
    const record = { protocolVersion: 1, instanceId, pid: process.pid, profile: 'desktop', dataDir,
      endpoint: origin + OPEN_PATH, token, startedAt: Date.now() };
    const fd = openSync(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    try { writeFileSync(fd, JSON.stringify(record) + '\n'); } finally { closeSync(fd); }
    // Both absolute paths are children of the verified private directory, never external input.
    if (dirname(temporary) !== directory || dirname(discovery) !== directory) throw new Error('Invalid discovery path');
    renameSync(temporary, discovery);
    return () => {
      bridge.dispose();
      // An older generation must not remove discovery belonging to its replacement.
      if (dirname(discovery) !== directory || !existsSync(discovery) || lstatSync(discovery).isSymbolicLink()) return;
      try {
        if (JSON.parse(readFileSync(discovery, 'utf8')).instanceId === instanceId) unlinkSync(discovery);
      } catch { /* An absent/replaced discovery record is already cleaned up. */ }
    };
  });

  ctx.effect(() => webServer.register({ kind: 'exact', path: OPEN_PATH, handler: async (req, res) => {
    if (!authorized(req, token, origin)) { json(res, 401, { status: 'unauthorized' }); return; }
    if (req.method !== 'POST') { res.setHeader('allow', 'POST'); json(res, 405, { status: 'method-not-allowed' }); return; }
    const readTimer = setTimeout(() => req.destroy(), 3000);
    let body;
    try { body = await bodyOf(req); }
    catch { json(res, 400, { protocolVersion: 1, status: 'invalid-request' }); return; }
    finally { clearTimeout(readTimer); }
    const result = await bridge.submit(body);
    json(res, result.status === 'not-ready' ? 503 : result.status === 'invalid-request' ? 400 : result.status === 'instance-mismatch' ? 409 : 200, result);
  } }));
  ctx.effect(() => webServer.register({ kind: 'exact', path: STATUS_PATH, handler: (req, res) => {
    if (!authorized(req, token, origin)) { json(res, 401, { status: 'unauthorized' }); return; }
    if (req.method !== 'GET') { res.setHeader('allow', 'GET'); json(res, 405, { status: 'method-not-allowed' }); return; }
    json(res, 200, bridge.status());
  } }));
  // DSH 0.2.2-rc.1's rpc.handle delegates through a Context without webServer injection.
  // Adapt its published JSON envelope on our owned route; Connection still admits every page.
  ctx.effect(() => webServer.register({ kind: 'prefix', path: CHANNEL, handler: async (req, res) => {
    const admission = connection.admit(req);
    if ('rejection' in admission) { json(res, admission.rejection, { status: 'unauthorized' }); return; }
    if (admission.peer.principal.kind !== 'owner') { json(res, 403, { status: 'forbidden' }); return; }
    const endpoint = req.url?.slice(CHANNEL.length + 1);
    if (req.method !== 'POST' || !['poll', 'authorize', 'ack', 'release'].includes(endpoint)) {
      json(res, 404, { status: 'not-found' }); return;
    }
    const readTimer = setTimeout(() => req.destroy(), 3000);
    let envelope;
    try { envelope = await bodyOf(req); }
    catch { json(res, 400, { status: 'invalid-request' }); return; }
    finally { clearTimeout(readTimer); }
    if (envelope?.type !== 'client-request' || envelope.method !== endpoint
        || typeof envelope.rpcId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(envelope.rpcId)) {
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
