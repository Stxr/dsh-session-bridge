// Generated from TypeScript by pnpm build. Edit src/, not this file.

// src/host/bridge.ts
import { randomBytes } from "node:crypto";

// src/shared/protocol.ts
var CHANNEL = "/huantai-session-bridge-v1";
var OPEN_PATH = "/huantai/session-bridge/v1/open";
var STATUS_PATH = "/huantai/session-bridge/v1/status";
var DESKTOP_PAGE = "dsh-app://app/";
var ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
function isRecord(value) {
  return typeof value === "object" && value !== null;
}
function field(value, key) {
  return isRecord(value) ? value[key] : void 0;
}
function isClientStatus(value) {
  return value === "opened" || value === "archived" || value === "load-failed" || value === "timeout" || value === "superseded" || value === "not-found" || value === "not-ready";
}

// src/host/jobs.ts
function createJob(body) {
  let resolve = () => {
  };
  const promise = new Promise((accept) => {
    resolve = accept;
  });
  return { body: { ...body }, promise, resolve };
}

// src/host/validation.ts
var REQUEST_FIELDS = /* @__PURE__ */ new Set(["protocolVersion", "instanceId", "requestId", "sessionId", "dataDir", "expiresAt"]);
function validRequest(body, instanceId, dataDir, now = Date.now()) {
  if (!isRecord(body) || Array.isArray(body) || Object.keys(body).some((key) => !REQUEST_FIELDS.has(key)) || body.protocolVersion !== 1 || typeof body.requestId !== "string" || !ID_PATTERN.test(body.requestId) || typeof body.sessionId !== "string" || !ID_PATTERN.test(body.sessionId) || typeof body.expiresAt !== "number" || !Number.isSafeInteger(body.expiresAt) || body.expiresAt > now + 16e3) return "invalid-request";
  if (body.instanceId !== instanceId || body.dataDir !== dataDir) return "instance-mismatch";
  if (body.expiresAt <= now) return "timeout";
  return void 0;
}

// src/host/bridge.ts
var Bridge = class {
  instanceId;
  dataDir;
  preflight;
  now;
  jobs = /* @__PURE__ */ new Map();
  consumer;
  waiter;
  active;
  disposed = false;
  lastResult;
  constructor({ instanceId, dataDir, preflight, now = Date.now }) {
    this.instanceId = instanceId;
    this.dataDir = dataDir;
    this.preflight = preflight;
    this.now = now;
  }
  result(body, status, message) {
    return {
      protocolVersion: 1,
      requestId: field(body, "requestId") ?? "",
      sessionId: field(body, "sessionId") ?? "",
      status,
      ...message ? { message } : {}
    };
  }
  status() {
    return {
      protocolVersion: 1,
      instanceId: this.instanceId,
      profile: "desktop",
      dataDir: this.dataDir,
      ready: !!this.consumer && this.consumer.until > this.now(),
      selectedSessionId: this.consumer?.selectedSessionId ?? null,
      lastResult: this.lastResult ?? null
    };
  }
  finish(job, status, message) {
    if (job.result) return job.result;
    job.result = this.result(job.body, status, message);
    clearTimeout(job.timer);
    job.resolve(job.result);
    this.lastResult = job.result;
    if (this.active === job) this.active = void 0;
    return job.result;
  }
  submit(body) {
    const refusal = validRequest(body, this.instanceId, this.dataDir, this.now());
    if (refusal) return Promise.resolve(this.result(body, refusal));
    const request = body;
    if (this.disposed) return Promise.resolve(this.result(request, "not-ready"));
    const previous = this.jobs.get(request.requestId);
    if (previous) {
      if (Object.keys(previous.body).some((key) => previous.body[key] !== request[key])) return Promise.resolve(this.result(request, "invalid-request"));
      return previous.promise;
    }
    if (!this.consumer || this.consumer.until <= this.now()) return Promise.resolve(this.result(request, "not-ready"));
    this.pruneJobs();
    if (this.jobs.size >= 256) {
      const oldest = [...this.jobs].find(([, job2]) => job2.result);
      if (oldest) this.jobs.delete(oldest[0]);
      else return Promise.resolve(this.result(request, "not-ready"));
    }
    if (this.active) this.finish(this.active, "superseded");
    const job = createJob(request);
    job.timer = setTimeout(() => this.finish(job, "timeout"), Math.max(1, request.expiresAt - this.now()));
    this.jobs.set(request.requestId, job);
    this.active = job;
    Promise.resolve().then(() => this.preflight(request.sessionId)).then((refusal2) => {
      if (job.result) return;
      if (refusal2) this.finish(job, refusal2);
      else {
        job.ready = true;
        this.deliver();
      }
    }, () => this.finish(job, "load-failed"));
    return job.promise;
  }
  owns(payload, peerId) {
    return !!this.consumer && this.consumer.id === field(payload, "clientId") && this.consumer.peerId === peerId && this.consumer.until > this.now();
  }
  async rpc(endpoint, payload, signal, peerId) {
    if (this.disposed) return { status: "not-ready" };
    if (endpoint === "poll") return this.poll(payload, signal, peerId);
    if (!this.owns(payload, peerId) || !this.consumer) return { status: "not-ready" };
    if (endpoint === "release") {
      this.consumer.until = 0;
      this.waiter?.end({ status: "idle" });
      return { status: "released" };
    }
    const job = this.jobs.get(field(payload, "requestId"));
    if (!job || job.result || job.body.expiresAt <= this.now() || this.active !== job || job.clientId !== field(payload, "clientId") || job.deliveryToken !== field(payload, "deliveryToken")) {
      return { status: "superseded" };
    }
    this.consumer.until = this.now() + 25e3;
    if (endpoint === "authorize") return { status: "authorized" };
    const status = field(payload, "status");
    if (endpoint === "ack" && isClientStatus(status)) {
      const selected = field(payload, "selectedSessionId");
      if (status === "opened" && selected !== job.body.sessionId) return { status: "invalid-request" };
      if (status === "opened") this.consumer.selectedSessionId = job.body.sessionId;
      return this.finish(job, status);
    }
    return { status: "invalid-request" };
  }
  deliver() {
    const job = this.active;
    if (!this.waiter || !job?.ready || job.result || job.clientId) return;
    if (job.body.expiresAt <= this.now()) {
      this.finish(job, "timeout");
      return;
    }
    job.clientId = this.waiter.clientId;
    job.deliveryToken = randomBytes(24).toString("hex");
    this.waiter.end({ status: "request", request: { ...job.body, deliveryToken: job.deliveryToken } });
  }
  dispose() {
    this.disposed = true;
    this.waiter?.end({ status: "not-ready" });
    for (const job of this.jobs.values()) this.finish(job, "not-ready");
    this.consumer = void 0;
  }
  pruneJobs() {
    for (const [id, job] of this.jobs) {
      if (job.result && job.body.expiresAt < this.now() - 6e4) this.jobs.delete(id);
    }
  }
  poll(payload, signal, peerId) {
    const clientId = field(payload, "clientId");
    if (!payload || !ID_PATTERN.test(clientId ?? "") || field(payload, "page") !== DESKTOP_PAGE || signal.aborted) return { status: "not-ready" };
    if (this.consumer && this.consumer.until > this.now() && !this.owns(payload, peerId)) return { status: "busy" };
    const selected = field(payload, "selectedSessionId");
    this.consumer = {
      id: clientId,
      peerId,
      until: this.now() + 25e3,
      selectedSessionId: typeof selected === "string" && ID_PATTERN.test(selected) ? selected : null
    };
    if (this.waiter) this.waiter.end({ status: "idle" });
    return new Promise((resolve) => {
      const end = (value) => {
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        if (this.waiter?.end === end) this.waiter = void 0;
        resolve(value);
      };
      const abort = () => {
        if (this.owns(payload, peerId) && this.consumer) this.consumer.until = 0;
        end({ status: "idle" });
      };
      const timer = setTimeout(() => end({ status: "idle" }), 2e4);
      this.waiter = { end, clientId };
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
      else this.deliver();
    });
  }
};

// src/host/auth.ts
import { timingSafeEqual } from "node:crypto";
function authorized(req, token, origin) {
  const host = new URL(origin).host;
  if (req.headers.host !== host || req.headers.origin !== void 0 || req.headers["sec-fetch-site"] === "cross-site" || !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress ?? "")) return false;
  const value = req.headers.authorization;
  if (typeof value !== "string") return false;
  const expected = Buffer.from("Bearer " + token);
  const actual = Buffer.from(value);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
export {
  Bridge,
  CHANNEL,
  OPEN_PATH,
  STATUS_PATH,
  authorized,
  validRequest
};
