window.__ModuleLoader__.load({
  id: '@stxr/dsh-session-bridge',
  factory() {
    const channel = '/huantai-session-bridge-v1';
    function waitFor(source, predicate, signal) {
      return new Promise((resolve, reject) => {
        let unsubscribe;
        let settled = false;
        const done = error => {
          if (settled) return;
          settled = true;
          unsubscribe?.();
          signal.removeEventListener('abort', abort);
          error ? reject(error) : resolve();
        };
        const check = () => { if (predicate(source.getSnapshot())) done(); };
        const abort = () => done(signal.reason ?? new Error('Cancelled'));
        signal.addEventListener('abort', abort, { once: true });
        unsubscribe = source.subscribe(check);
        if (settled) unsubscribe();
        if (signal.aborted) abort();
        else check();
      });
    }
    function delay(ms, signal) {
      return new Promise(resolve => {
        const end = () => { clearTimeout(timer); signal.removeEventListener('abort', end); resolve(); };
        const timer = setTimeout(end, ms);
        signal.addEventListener('abort', end, { once: true });
        if (signal.aborted) end();
      });
    }
    return {
      inject: ['connection', 'uiWorkspace', 'sessions', 'workspaces', 'layout'],
      apply(ctx) {
        // Never let browser tabs, embedded frames, or the welcome page consume a desktop jump.
        if (window !== window.top || window.location.protocol !== 'dsh-app:' || window.location.hostname !== 'app'
            || !['/', '/index.html'].includes(window.location.pathname)) return;
        const connection = ctx.connection;
        const sessions = ctx.sessions;
        const workspaces = ctx.workspaces;
        const current = () => Object.values(sessions.list.getSnapshot().byId)
          .find(row => (row.retainedBy?.mainView ?? 0) > 0)?.id ?? null;
        const clientId = crypto.randomUUID();
        const rpc = async (endpoint, payload, signal) => {
          const result = await connection.rpc.call(channel, endpoint, { clientId, ...payload }, signal);
          if (!result.ok) throw new Error(result.error.message);
          return result.value;
        };
        ctx.effect(() => {
          const lifetime = new AbortController();
          const signal = lifetime.signal;
          async function open(request) {
            const deadline = new AbortController();
            const timer = setTimeout(() => deadline.abort(new Error('Expired')), Math.max(0, request.expiresAt - Date.now()));
            const operation = AbortSignal.any([signal, deadline.signal]);
            let status = 'load-failed';
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
                  // Cancel a pending first-use restoration or Workspace connection before selecting the target.
                  ctx.layout.beginNavigation();
                  ctx.uiWorkspace.openSession(request.sessionId);
                  const selected = current();
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
            if (!signal.aborted) await rpc('ack', { ...request, status, selectedSessionId: current() }, signal);
          }
          async function run() {
            while (!signal.aborted) {
              try {
                await waitFor(connection.state, value => value === 'connected', signal);
                await waitFor(sessions.list, value => value.phase === 'ready', signal);
                await waitFor(workspaces.list, value => value.phase === 'ready', signal);
                const value = await rpc('poll', { page: 'dsh-app://app/', selectedSessionId: current() }, signal);
                if (value.status === 'request') await open(value.request);
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
      },
    };
  },
});
