import type { Bridge } from './bridge.js';
import type { HostContext } from './context.js';
/** Own the two external token routes and the admitted DSH RPC-envelope route. */
export declare function registerRoutes(ctx: HostContext, bridge: Bridge, token: string, origin: string): void;
