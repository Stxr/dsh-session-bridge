import type { SnapshotSource } from './context.js';
/** Subscribe before the initial read so a synchronous update cannot be missed. */
export declare function waitFor<Value>(source: SnapshotSource<Value>, predicate: (value: Value) => boolean, signal: AbortSignal): Promise<void>;
export declare function delay(ms: number, signal: AbortSignal): Promise<void>;
