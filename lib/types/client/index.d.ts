import type { ClientContext } from './context.js';
export declare const inject: string[];
/** Only the top-level desktop main page can consume the Host's navigation lease. */
export declare function apply(ctx: ClientContext): void;
export type { ClientContext } from './context.js';
