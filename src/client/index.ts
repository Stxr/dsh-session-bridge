import { DESKTOP_PAGE } from '../shared/protocol.js';
import { delay, waitFor } from './async.js';
import type { ClientContext } from './context.js';
import { currentSession, openRequest } from './navigation.js';
import { createRpc } from './rpc.js';

export const inject = ['connection', 'uiWorkspace', 'sessions', 'workspaces', 'layout'];

/** Only the top-level desktop main page can consume the Host's navigation lease. */
export function apply(ctx: ClientContext): void {
  if (window !== window.top || window.location.protocol !== 'dsh-app:' || window.location.hostname !== 'app'
    || !['/', '/index.html'].includes(window.location.pathname)) return;
  const { connection, sessions, workspaces } = ctx;
  const rpc = createRpc(connection, crypto.randomUUID());
  ctx.effect(() => {
    const lifetime = new AbortController();
    const signal = lifetime.signal;
    async function run(): Promise<void> {
      while (!signal.aborted) {
        try {
          await waitFor(connection.state, value => value === 'connected', signal);
          await waitFor(sessions.list, value => value.phase === 'ready', signal);
          await waitFor(workspaces.list, value => value.phase === 'ready', signal);
          const value = await rpc('poll', { page: DESKTOP_PAGE, selectedSessionId: currentSession(ctx) }, signal);
          if (value.status === 'request') await openRequest(ctx, value.request, rpc, signal);
          else if (value.status !== 'idle') await delay(1000, signal);
        } catch {
          if (!signal.aborted) await delay(1000, signal);
        }
      }
    }
    void run();
    return () => {
      lifetime.abort();
      void rpc('release', {}, undefined).catch(() => {});
    };
  });
}

export type { ClientContext } from './context.js';
