// Generated from TypeScript by pnpm build. Edit src/, not this file.
window.__ModuleLoader__.load({
  id: "@stxr/dsh-session-bridge",
  factory() {
    const module = { exports: {} };
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.ts
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(index_exports);

// src/shared/protocol.ts
var CHANNEL = "/huantai-session-bridge-v1";
var DESKTOP_PAGE = "dsh-app://app/";

// src/client/async.ts
function waitFor(source, predicate, signal) {
  return new Promise((resolve, reject) => {
    let unsubscribe;
    let settled = false;
    const done = (error) => {
      if (settled) return;
      settled = true;
      unsubscribe?.();
      signal.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve();
    };
    const check = () => {
      if (predicate(source.getSnapshot())) done();
    };
    const abort = () => done(signal.reason ?? new Error("Cancelled"));
    signal.addEventListener("abort", abort, { once: true });
    unsubscribe = source.subscribe(check);
    if (settled) unsubscribe();
    if (signal.aborted) abort();
    else check();
  });
}
function delay(ms, signal) {
  return new Promise((resolve) => {
    const end = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", end);
      resolve();
    };
    const timer = setTimeout(end, ms);
    signal.addEventListener("abort", end, { once: true });
    if (signal.aborted) end();
  });
}

// src/client/navigation.ts
function currentSession(ctx) {
  return Object.values(ctx.sessions.list.getSnapshot().byId).find((row) => (row?.retainedBy?.mainView ?? 0) > 0)?.id ?? null;
}
async function openRequest(ctx, request, rpc, signal) {
  const { sessions, workspaces } = ctx;
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(new Error("Expired")), Math.max(0, request.expiresAt - Date.now()));
  const operation = AbortSignal.any([signal, deadline.signal]);
  let status = "load-failed";
  try {
    operation.throwIfAborted();
    if (request.expiresAt <= Date.now()) return;
    if (workspaces.list.getSnapshot().archivedSessionIds.includes(request.sessionId)) status = "archived";
    else if (!sessions.list.getSnapshot().byId[request.sessionId]) status = "not-found";
    else {
      await sessions.using(request.sessionId, { source: "controllerOperation", signal: operation }, async (reference) => {
        const binding = await reference.ready;
        operation.throwIfAborted();
        const snapshot = binding.session.getSnapshot();
        if (snapshot.removed || snapshot.openState !== "open") {
          status = "load-failed";
          return;
        }
        if (workspaces.list.getSnapshot().archivedSessionIds.includes(request.sessionId)) {
          status = "archived";
          return;
        }
        const permit = await rpc("authorize", request, operation);
        operation.throwIfAborted();
        if (permit.status !== "authorized" || Date.now() >= request.expiresAt) {
          status = "superseded";
          return;
        }
        ctx.layout.beginNavigation();
        ctx.uiWorkspace.openSession(request.sessionId);
        const selected = currentSession(ctx);
        status = selected === request.sessionId && (sessions.retainInfo(request.sessionId).getSnapshot().retainedBy.mainView ?? 0) > 0 ? "opened" : "superseded";
      });
    }
  } catch {
    status = operation.aborted ? "timeout" : "load-failed";
  } finally {
    clearTimeout(timer);
  }
  if (!signal.aborted) await rpc("ack", { ...request, status, selectedSessionId: currentSession(ctx) }, signal);
}

// src/client/rpc.ts
function createRpc(connection, clientId) {
  return async (endpoint, payload, signal) => {
    const result = await connection.rpc.call(CHANNEL, endpoint, { clientId, ...payload }, signal);
    if (!result.ok) throw new Error(result.error.message);
    return result.value;
  };
}

// src/client/index.ts
var inject = ["connection", "uiWorkspace", "sessions", "workspaces", "layout"];
function apply(ctx) {
  if (window !== window.top || window.location.protocol !== "dsh-app:" || window.location.hostname !== "app" || !["/", "/index.html"].includes(window.location.pathname)) return;
  const { connection, sessions, workspaces } = ctx;
  const rpc = createRpc(connection, crypto.randomUUID());
  ctx.effect(() => {
    const lifetime = new AbortController();
    const signal = lifetime.signal;
    async function run() {
      while (!signal.aborted) {
        try {
          await waitFor(connection.state, (value2) => value2 === "connected", signal);
          await waitFor(sessions.list, (value2) => value2.phase === "ready", signal);
          await waitFor(workspaces.list, (value2) => value2.phase === "ready", signal);
          const value = await rpc("poll", { page: DESKTOP_PAGE, selectedSessionId: currentSession(ctx) }, signal);
          if (value.status === "request") await openRequest(ctx, value.request, rpc, signal);
          else if (value.status !== "idle") await delay(1e3, signal);
        } catch {
          if (!signal.aborted) await delay(1e3, signal);
        }
      }
    }
    void run();
    return () => {
      lifetime.abort();
      void rpc("release", {}, void 0).catch(() => {
      });
    };
  });
}
    return module.exports;
  }
});
