// Generated from TypeScript by pnpm build. Edit src/, not this file.

// src/host/index.ts
import { randomBytes as randomBytes2, randomUUID } from "node:crypto";
import { realpathSync as realpathSync2 } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join as join2, resolve } from "node:path";

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
function isRpcEndpoint(value) {
  return value === "poll" || value === "authorize" || value === "ack" || value === "release";
}
function isClientStatus(value) {
  return value === "opened" || value === "archived" || value === "load-failed" || value === "timeout" || value === "superseded" || value === "not-found" || value === "not-ready";
}

// src/host/jobs.ts
function createJob(body) {
  let resolve2 = () => {
  };
  const promise = new Promise((accept) => {
    resolve2 = accept;
  });
  return { body: { ...body }, promise, resolve: resolve2 };
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
    return new Promise((resolve2) => {
      const end = (value) => {
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        if (this.waiter?.end === end) this.waiter = void 0;
        resolve2(value);
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

// src/host/discovery.ts
import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { dirname, join } from "node:path";
function publishDiscovery({ dataDir, instanceId, origin, token }, disposeBridge) {
  const directory = join(dataDir, "huantai-bridge");
  mkdirSync(directory, { recursive: true, mode: 448 });
  if (lstatSync(directory).isSymbolicLink() || realpathSync(directory) !== directory) {
    throw new Error("Huantai discovery directory must not be a symlink");
  }
  chmodSync(directory, 448);
  const discovery = join(directory, "desktop.json");
  const temporary = join(directory, instanceId + ".tmp");
  const record = {
    protocolVersion: 1,
    instanceId,
    pid: process.pid,
    profile: "desktop",
    dataDir,
    endpoint: origin + OPEN_PATH,
    token,
    startedAt: Date.now()
  };
  const fd = openSync(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 384);
  try {
    writeFileSync(fd, JSON.stringify(record) + "\n");
  } finally {
    closeSync(fd);
  }
  if (dirname(temporary) !== directory || dirname(discovery) !== directory) throw new Error("Invalid discovery path");
  renameSync(temporary, discovery);
  return () => {
    disposeBridge();
    if (dirname(discovery) !== directory || !existsSync(discovery) || lstatSync(discovery).isSymbolicLink()) return;
    try {
      const value = JSON.parse(readFileSync(discovery, "utf8"));
      if (field(value, "instanceId") === instanceId) unlinkSync(discovery);
    } catch {
    }
  };
}

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

// src/host/http.ts
function json(res, code, value) {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
  res.end(JSON.stringify(value));
}
async function bodyOf(req) {
  if (!/^application\/json(?:\s*;.*)?$/i.test(req.headers["content-type"] ?? "")) throw new Error("content-type");
  if (Number(req.headers["content-length"] ?? 0) > 8192) throw new Error("too-large");
  const chunks = [];
  let bytes = 0;
  for await (const value of req) {
    const chunk = value;
    bytes += chunk.length;
    if (bytes > 8192) throw new Error("too-large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
function registerRoutes(ctx, bridge, token, origin) {
  const { webServer, connection } = ctx;
  ctx.effect(() => webServer.register({ kind: "exact", path: OPEN_PATH, handler: async (req, res) => {
    if (!authorized(req, token, origin)) {
      json(res, 401, { status: "unauthorized" });
      return;
    }
    if (req.method !== "POST") {
      res.setHeader("allow", "POST");
      json(res, 405, { status: "method-not-allowed" });
      return;
    }
    const readTimer = setTimeout(() => req.destroy(), 3e3);
    let body;
    try {
      body = await bodyOf(req);
    } catch {
      json(res, 400, { protocolVersion: 1, status: "invalid-request" });
      return;
    } finally {
      clearTimeout(readTimer);
    }
    const result = await bridge.submit(body);
    json(res, result.status === "not-ready" ? 503 : result.status === "invalid-request" ? 400 : result.status === "instance-mismatch" ? 409 : 200, result);
  } }));
  ctx.effect(() => webServer.register({ kind: "exact", path: STATUS_PATH, handler: (req, res) => {
    if (!authorized(req, token, origin)) {
      json(res, 401, { status: "unauthorized" });
      return;
    }
    if (req.method !== "GET") {
      res.setHeader("allow", "GET");
      json(res, 405, { status: "method-not-allowed" });
      return;
    }
    json(res, 200, bridge.status());
  } }));
  ctx.effect(() => webServer.register({ kind: "prefix", path: CHANNEL, handler: async (req, res) => {
    const admission = connection.admit(req);
    if ("rejection" in admission) {
      json(res, admission.rejection, { status: "unauthorized" });
      return;
    }
    if (admission.peer.principal.kind !== "owner") {
      json(res, 403, { status: "forbidden" });
      return;
    }
    const endpoint = req.url?.slice(CHANNEL.length + 1);
    if (req.method !== "POST" || !isRpcEndpoint(endpoint)) {
      json(res, 404, { status: "not-found" });
      return;
    }
    const readTimer = setTimeout(() => req.destroy(), 3e3);
    let envelope;
    try {
      envelope = await bodyOf(req);
    } catch {
      json(res, 400, { status: "invalid-request" });
      return;
    } finally {
      clearTimeout(readTimer);
    }
    if (!isRecord(envelope) || envelope.type !== "client-request" || envelope.method !== endpoint || typeof envelope.rpcId !== "string" || !ID_PATTERN.test(envelope.rpcId)) {
      json(res, 400, { status: "invalid-request" });
      return;
    }
    const controller = new AbortController();
    const abort = () => controller.abort();
    res.once("close", abort);
    try {
      const value = await bridge.rpc(endpoint, envelope.payload, controller.signal, admission.peer.id);
      json(res, 200, { type: "server-response", rpcId: envelope.rpcId, result: { ok: true, value } });
    } finally {
      res.removeListener("close", abort);
    }
  } }));
}

// src/host/index.ts
var inject = ["webServer", "connection", "sessionPersistence", "sessions", "profileContext"];
function apply(ctx) {
  const profile = ctx.get("profileContext");
  if (profile?.name !== "desktop") return;
  const root = profile.home || process.env.DSH_HOME || join2(homedir(), ".dsh");
  if (!isAbsolute(root)) throw new Error("Huantai bridge requires an absolute DSH_HOME");
  const dataDir = realpathSync2(root);
  const origin = ctx.webServer.getOrigin();
  const url = new URL(origin);
  if (url.hostname !== "127.0.0.1" || url.protocol !== "http:") throw new Error("Huantai bridge requires a loopback HTTP Host");
  const instanceId = randomUUID();
  const token = randomBytes2(32).toString("hex");
  const bridge = new Bridge({ instanceId, dataDir, preflight: async (sessionId) => {
    const live = ctx.sessions.get(sessionId);
    const stored = await ctx.sessionPersistence.stat(sessionId);
    const header = live?.header ?? stored?.header;
    if (!header) return "not-found";
    if (header.origin === "subagent") return "unsupported-target";
    if (stored?.location?.path && !resolve(stored.location.path).startsWith(join2(dataDir, "sessions") + "/")) {
      return "instance-mismatch";
    }
    return void 0;
  } });
  ctx.effect(() => publishDiscovery({ dataDir, instanceId, origin, token }, () => bridge.dispose()));
  registerRoutes(ctx, bridge, token, origin);
}
export {
  apply,
  inject
};
