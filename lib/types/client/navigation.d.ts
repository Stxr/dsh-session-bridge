import type { DeliveredRequest } from '../shared/protocol.js';
import type { ClientContext } from './context.js';
import type { CallBridge } from './rpc.js';
/** Read the actual main-view retain, rather than assuming an openSession call won. */
export declare function currentSession(ctx: ClientContext): string | null;
/** Load first, then reauthorize immediately before canceling restoration and selecting. */
export declare function openRequest(ctx: ClientContext, request: DeliveredRequest, rpc: CallBridge, signal: AbortSignal): Promise<void>;
