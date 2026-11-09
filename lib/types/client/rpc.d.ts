import type { RpcEndpoint, RpcResult } from '../shared/protocol.js';
import type { ClientContext } from './context.js';
export type CallBridge = (endpoint: RpcEndpoint, payload: object, signal?: AbortSignal) => Promise<RpcResult>;
/** The admitted Host endpoint owns the protocol; Client uses DSH's RPC envelope. */
export declare function createRpc(connection: ClientContext['connection'], clientId: string): CallBridge;
