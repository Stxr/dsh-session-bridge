import type { ClientStatus, DeliveredRequest } from '../shared/protocol.js';
import type { ClientContext } from './context.js';
import type { CallBridge } from './rpc.js';

/** Read the actual main-view retain, rather than assuming an openSession call won. */
export function currentSession(ctx: ClientContext): string | null {
  return Object.values(ctx.sessions.list.getSnapshot().byId)
    .find(row => (row?.retainedBy?.mainView ?? 0) > 0)?.id ?? null;
}

/** Load first, then reauthorize immediately before canceling restoration and selecting. */
export async function openRequest(ctx: ClientContext, request: DeliveredRequest, rpc: CallBridge, signal: AbortSignal): Promise<void> {
  const { sessions, workspaces } = ctx;
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(new Error('Expired')), Math.max(0, request.expiresAt - Date.now()));
  const operation = AbortSignal.any([signal, deadline.signal]);
  let status: ClientStatus = 'load-failed';
  try {
    operation.throwIfAborted();
    if (request.expiresAt <= Date.now()) return;
    if (workspaces.list.getSnapshot().archivedSessionIds.includes(request.sessionId)) status = 'archived';
    else if (!sessions.list.getSnapshot().byId[request.sessionId]) status = 'not-found';
    else {
      await sessions.using(request.sessionId, { source: 'controllerOperation', signal: operation }, async reference => {
        const binding = await reference.ready;
        operation.throwIfAborted();
        const snapshot = binding.session.getSnapshot();
        if (snapshot.removed || snapshot.openState !== 'open') { status = 'load-failed'; return; }
        if (workspaces.list.getSnapshot().archivedSessionIds.includes(request.sessionId)) { status = 'archived'; return; }
        const permit = await rpc('authorize', request, operation);
        operation.throwIfAborted();
        if (permit.status !== 'authorized' || Date.now() >= request.expiresAt) { status = 'superseded'; return; }
        ctx.layout.beginNavigation();
        ctx.uiWorkspace.openSession(request.sessionId);
        const selected = currentSession(ctx);
        status = selected === request.sessionId
          && (sessions.retainInfo(request.sessionId).getSnapshot().retainedBy.mainView ?? 0) > 0
          ? 'opened' : 'superseded';
      });
    }
  } catch {
    status = operation.aborted ? 'timeout' : 'load-failed';
  } finally {
    clearTimeout(timer);
  }
  if (!signal.aborted) await rpc('ack', { ...request, status, selectedSessionId: currentSession(ctx) }, signal);
}
