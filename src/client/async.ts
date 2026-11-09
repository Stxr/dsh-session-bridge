import type { Dispose, SnapshotSource } from './context.js';

/** Subscribe before the initial read so a synchronous update cannot be missed. */
export function waitFor<Value>(source: SnapshotSource<Value>, predicate: (value: Value) => boolean, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    let unsubscribe: Dispose | undefined;
    let settled = false;
    const done = (error?: unknown) => {
      if (settled) return;
      settled = true;
      unsubscribe?.();
      signal.removeEventListener('abort', abort);
      if (error) reject(error);
      else resolve();
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

export function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    const end = () => { clearTimeout(timer); signal.removeEventListener('abort', end); resolve(); };
    const timer = setTimeout(end, ms);
    signal.addEventListener('abort', end, { once: true });
    if (signal.aborted) end();
  });
}
