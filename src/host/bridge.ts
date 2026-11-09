import { randomBytes } from 'node:crypto';
import { DESKTOP_PAGE, field, ID_PATTERN, isClientStatus } from '../shared/protocol.js';
import type {
  BridgeStatus, OpenRequest, OpenResult, PreflightStatus, ResultStatus, RpcResult,
} from '../shared/protocol.js';
import { createJob } from './jobs.js';
import type { Consumer, Job, PollWaiter } from './jobs.js';
import { validRequest } from './validation.js';

export interface BridgeOptions {
  instanceId: string;
  dataDir: string;
  preflight(sessionId: string): PreflightStatus | undefined | Promise<PreflightStatus | undefined>;
  now?: () => number;
}

/** One desktop instance's bounded request queue and authenticated consumer lease. */
export class Bridge {
  readonly instanceId: string;
  readonly dataDir: string;
  readonly preflight: BridgeOptions['preflight'];
  readonly now: () => number;
  readonly jobs = new Map<string, Job>();
  consumer: Consumer | undefined;
  waiter: PollWaiter | undefined;
  active: Job | undefined;
  disposed = false;
  lastResult: OpenResult | undefined;

  constructor({ instanceId, dataDir, preflight, now = Date.now }: BridgeOptions) {
    this.instanceId = instanceId;
    this.dataDir = dataDir;
    this.preflight = preflight;
    this.now = now;
  }

  result(body: unknown, status: ResultStatus, message?: string): OpenResult {
    return { protocolVersion: 1, requestId: field(body, 'requestId') ?? '', sessionId: field(body, 'sessionId') ?? '', status,
      ...(message ? { message } : {}) };
  }

  status(): BridgeStatus {
    return { protocolVersion: 1, instanceId: this.instanceId, profile: 'desktop', dataDir: this.dataDir,
      ready: !!this.consumer && this.consumer.until > this.now(),
      selectedSessionId: this.consumer?.selectedSessionId ?? null,
      lastResult: this.lastResult ?? null };
  }

  finish(job: Job, status: ResultStatus, message?: string): OpenResult {
    if (job.result) return job.result;
    job.result = this.result(job.body, status, message);
    clearTimeout(job.timer);
    job.resolve(job.result);
    this.lastResult = job.result;
    if (this.active === job) this.active = undefined;
    return job.result;
  }

  submit(body: unknown): Promise<OpenResult> {
    const refusal = validRequest(body, this.instanceId, this.dataDir, this.now());
    if (refusal) return Promise.resolve(this.result(body, refusal));
    // validRequest proves the fields used below; it does not rewrite the input.
    const request = body as OpenRequest;
    if (this.disposed) return Promise.resolve(this.result(request, 'not-ready'));
    const previous = this.jobs.get(request.requestId);
    if (previous) {
      if ((Object.keys(previous.body) as Array<keyof OpenRequest>)
        .some(key => previous.body[key] !== request[key])) return Promise.resolve(this.result(request, 'invalid-request'));
      return previous.promise;
    }
    if (!this.consumer || this.consumer.until <= this.now()) return Promise.resolve(this.result(request, 'not-ready'));
    this.pruneJobs();
    if (this.jobs.size >= 256) {
      const oldest = [...this.jobs].find(([, job]) => job.result);
      if (oldest) this.jobs.delete(oldest[0]);
      else return Promise.resolve(this.result(request, 'not-ready'));
    }
    if (this.active) this.finish(this.active, 'superseded');
    const job = createJob(request);
    job.timer = setTimeout(() => this.finish(job, 'timeout'), Math.max(1, request.expiresAt - this.now()));
    this.jobs.set(request.requestId, job);
    this.active = job;
    // Publish only after preflight, then recheck identity after the async read.
    Promise.resolve().then(() => this.preflight(request.sessionId)).then(refusal => {
      if (job.result) return;
      if (refusal) this.finish(job, refusal);
      else { job.ready = true; this.deliver(); }
    }, () => this.finish(job, 'load-failed'));
    return job.promise;
  }

  owns(payload: unknown, peerId: string): boolean {
    return !!this.consumer && this.consumer.id === field(payload, 'clientId')
      && this.consumer.peerId === peerId && this.consumer.until > this.now();
  }

  async rpc(endpoint: string, payload: unknown, signal: AbortSignal, peerId: string): Promise<RpcResult> {
    if (this.disposed) return { status: 'not-ready' };
    if (endpoint === 'poll') return this.poll(payload, signal, peerId);
    if (!this.owns(payload, peerId) || !this.consumer) return { status: 'not-ready' };
    if (endpoint === 'release') {
      this.consumer.until = 0;
      this.waiter?.end({ status: 'idle' });
      return { status: 'released' };
    }
    const job = this.jobs.get(field(payload, 'requestId') as string);
    if (!job || job.result || job.body.expiresAt <= this.now() || this.active !== job
      || job.clientId !== field(payload, 'clientId') || job.deliveryToken !== field(payload, 'deliveryToken')) {
      return { status: 'superseded' };
    }
    this.consumer.until = this.now() + 25000;
    if (endpoint === 'authorize') return { status: 'authorized' };
    const status = field(payload, 'status');
    if (endpoint === 'ack' && isClientStatus(status)) {
      const selected = field(payload, 'selectedSessionId');
      if (status === 'opened' && selected !== job.body.sessionId) return { status: 'invalid-request' };
      if (status === 'opened') this.consumer.selectedSessionId = job.body.sessionId;
      return this.finish(job, status);
    }
    return { status: 'invalid-request' };
  }

  deliver(): void {
    const job = this.active;
    if (!this.waiter || !job?.ready || job.result || job.clientId) return;
    if (job.body.expiresAt <= this.now()) { this.finish(job, 'timeout'); return; }
    job.clientId = this.waiter.clientId;
    job.deliveryToken = randomBytes(24).toString('hex');
    this.waiter.end({ status: 'request', request: { ...job.body, deliveryToken: job.deliveryToken } });
  }

  dispose(): void {
    this.disposed = true;
    this.waiter?.end({ status: 'not-ready' });
    for (const job of this.jobs.values()) this.finish(job, 'not-ready');
    this.consumer = undefined;
  }

  private pruneJobs(): void {
    // Keep completed idempotency records for one minute, with a hard memory bound.
    for (const [id, job] of this.jobs) {
      if (job.result && job.body.expiresAt < this.now() - 60000) this.jobs.delete(id);
    }
  }

  private poll(payload: unknown, signal: AbortSignal, peerId: string): RpcResult | Promise<RpcResult> {
    const clientId = field(payload, 'clientId');
    // RegExp.test intentionally retains v1's coercion for the internal poll ID.
    if (!payload || !ID_PATTERN.test((clientId ?? '') as string)
      || field(payload, 'page') !== DESKTOP_PAGE || signal.aborted) return { status: 'not-ready' };
    if (this.consumer && this.consumer.until > this.now() && !this.owns(payload, peerId)) return { status: 'busy' };
    const selected = field(payload, 'selectedSessionId');
    this.consumer = { id: clientId, peerId, until: this.now() + 25000,
      selectedSessionId: typeof selected === 'string' && ID_PATTERN.test(selected) ? selected : null };
    if (this.waiter) this.waiter.end({ status: 'idle' });
    return new Promise<RpcResult>(resolve => {
      const end = (value: RpcResult) => {
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        if (this.waiter?.end === end) this.waiter = undefined;
        resolve(value);
      };
      const abort = () => {
        if (this.owns(payload, peerId) && this.consumer) this.consumer.until = 0;
        end({ status: 'idle' });
      };
      const timer = setTimeout(() => end({ status: 'idle' }), 20000);
      this.waiter = { end, clientId };
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
      else this.deliver();
    });
  }
}
