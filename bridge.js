import { randomBytes, timingSafeEqual } from 'node:crypto';

export const CHANNEL = '/huantai-session-bridge-v1';
export const OPEN_PATH = '/huantai/session-bridge/v1/open';
export const STATUS_PATH = '/huantai/session-bridge/v1/status';
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const CLIENT_STATUSES = new Set(['opened', 'archived', 'load-failed', 'timeout', 'superseded', 'not-found', 'not-ready']);

export function validRequest(body, instanceId, dataDir, now = Date.now()) {
  if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).some(key => !['protocolVersion', 'instanceId', 'requestId', 'sessionId', 'dataDir', 'expiresAt'].includes(key))
      || body.protocolVersion !== 1 || !ID.test(body.requestId ?? '') || !ID.test(body.sessionId ?? '')
      || typeof body.requestId !== 'string' || typeof body.sessionId !== 'string'
      || !Number.isSafeInteger(body.expiresAt) || body.expiresAt > now + 16000) return 'invalid-request';
  if (body.instanceId !== instanceId || body.dataDir !== dataDir) return 'instance-mismatch';
  if (body.expiresAt <= now) return 'timeout';
}

export function authorized(req, token, origin) {
  const host = new URL(origin).host;
  if (req.headers.host !== host || req.headers.origin !== undefined
      || req.headers['sec-fetch-site'] === 'cross-site'
      || !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) return false;
  const value = req.headers.authorization;
  if (typeof value !== 'string') return false;
  const expected = Buffer.from('Bearer ' + token);
  const actual = Buffer.from(value);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export class Bridge {
  constructor({ instanceId, dataDir, preflight, now = Date.now }) {
    Object.assign(this, { instanceId, dataDir, preflight, now });
    this.jobs = new Map();
    this.consumer = undefined;
    this.waiter = undefined;
    this.active = undefined;
    this.disposed = false;
  }

  result(body, status, message) {
    return { protocolVersion: 1, requestId: body?.requestId ?? '', sessionId: body?.sessionId ?? '', status,
      ...(message ? { message } : {}) };
  }

  status() {
    return { protocolVersion: 1, instanceId: this.instanceId, profile: 'desktop', dataDir: this.dataDir,
      ready: !!this.consumer && this.consumer.until > this.now(),
      selectedSessionId: this.consumer?.selectedSessionId ?? null,
      lastResult: this.lastResult ?? null };
  }

  finish(job, status, message) {
    if (job.result) return job.result;
    job.result = this.result(job.body, status, message);
    clearTimeout(job.timer);
    job.resolve(job.result);
    this.lastResult = job.result;
    if (this.active === job) this.active = undefined;
    return job.result;
  }

  submit(body) {
    const refusal = validRequest(body, this.instanceId, this.dataDir, this.now());
    if (refusal) return Promise.resolve(this.result(body, refusal));
    if (this.disposed) return Promise.resolve(this.result(body, 'not-ready'));
    const previous = this.jobs.get(body.requestId);
    if (previous) {
      if (Object.keys(previous.body).some(key => previous.body[key] !== body[key])) return Promise.resolve(this.result(body, 'invalid-request'));
      return previous.promise;
    }
    if (!this.consumer || this.consumer.until <= this.now()) return Promise.resolve(this.result(body, 'not-ready'));
    // Keep completed idempotency records for one minute, with a hard memory bound.
    for (const [id, job] of this.jobs) if (job.result && job.body.expiresAt < this.now() - 60000) this.jobs.delete(id);
    if (this.jobs.size >= 256) {
      const oldest = [...this.jobs].find(([, job]) => job.result);
      if (oldest) this.jobs.delete(oldest[0]);
      else return Promise.resolve(this.result(body, 'not-ready'));
    }
    if (this.active) this.finish(this.active, 'superseded');
    const job = { body: { ...body } };
    job.promise = new Promise(resolve => { job.resolve = resolve; });
    job.timer = setTimeout(() => this.finish(job, 'timeout'), Math.max(1, body.expiresAt - this.now()));
    this.jobs.set(body.requestId, job);
    this.active = job;
    // Publish only after preflight, and check identity again after the asynchronous read.
    Promise.resolve().then(() => this.preflight(body.sessionId)).then(refusal => {
      if (job.result) return;
      if (refusal) this.finish(job, refusal);
      else { job.ready = true; this.deliver(); }
    }, () => this.finish(job, 'load-failed'));
    return job.promise;
  }

  owns(payload, peerId) {
    return this.consumer?.id === payload?.clientId && this.consumer?.peerId === peerId
      && this.consumer.until > this.now();
  }

  async rpc(endpoint, payload, signal, peerId) {
    if (this.disposed) return { status: 'not-ready' };
    if (endpoint === 'poll') {
      if (!payload || !ID.test(payload.clientId ?? '') || payload.page !== 'dsh-app://app/' || signal.aborted) return { status: 'not-ready' };
      if (this.consumer && this.consumer.until > this.now() && !this.owns(payload, peerId)) return { status: 'busy' };
      this.consumer = { id: payload.clientId, peerId, until: this.now() + 25000,
        selectedSessionId: typeof payload.selectedSessionId === 'string' && ID.test(payload.selectedSessionId) ? payload.selectedSessionId : null };
      if (this.waiter) this.waiter.end({ status: 'idle' });
      return new Promise(resolve => {
        const end = value => {
          clearTimeout(timer);
          signal.removeEventListener('abort', abort);
          if (this.waiter?.end === end) this.waiter = undefined;
          resolve(value);
        };
        const abort = () => {
          if (this.owns(payload, peerId)) this.consumer.until = 0;
          end({ status: 'idle' });
        };
        const timer = setTimeout(() => end({ status: 'idle' }), 20000);
        this.waiter = { end, clientId: payload.clientId };
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
        else this.deliver();
      });
    }
    if (!this.owns(payload, peerId)) return { status: 'not-ready' };
    if (endpoint === 'release') {
      this.consumer.until = 0;
      this.waiter?.end({ status: 'idle' });
      return { status: 'released' };
    }
    const job = this.jobs.get(payload?.requestId);
    if (!job || job.result || job.body.expiresAt <= this.now() || this.active !== job
        || job.clientId !== payload.clientId || job.deliveryToken !== payload.deliveryToken) return { status: 'superseded' };
    this.consumer.until = this.now() + 25000;
    if (endpoint === 'authorize') return { status: 'authorized' };
    if (endpoint === 'ack' && CLIENT_STATUSES.has(payload.status)) {
      if (payload.status === 'opened' && payload.selectedSessionId !== job.body.sessionId) return { status: 'invalid-request' };
      if (payload.status === 'opened') this.consumer.selectedSessionId = payload.selectedSessionId;
      return this.finish(job, payload.status);
    }
    return { status: 'invalid-request' };
  }

  deliver() {
    const job = this.active;
    if (!this.waiter || !job?.ready || job.result || job.clientId) return;
    if (job.body.expiresAt <= this.now()) { this.finish(job, 'timeout'); return; }
    job.clientId = this.waiter.clientId;
    job.deliveryToken = randomBytes(24).toString('hex');
    this.waiter.end({ status: 'request', request: { ...job.body, deliveryToken: job.deliveryToken } });
  }

  dispose() {
    this.disposed = true;
    this.waiter?.end({ status: 'not-ready' });
    for (const job of this.jobs.values()) this.finish(job, 'not-ready');
    this.consumer = undefined;
  }
}
