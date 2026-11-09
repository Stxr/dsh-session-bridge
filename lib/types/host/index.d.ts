import type { HostContext } from './context.js';
export declare const inject: string[];
/** Desktop Host entry; web profiles never own discovery or bridge routes. */
export declare function apply(ctx: HostContext): void;
export type { HostContext } from './context.js';
