import { CHANNEL } from '../shared/protocol.js';
import type { RpcEndpoint, RpcResult } from '../shared/protocol.js';
import type { ClientContext } from './context.js';

export type CallBridge = (endpoint: RpcEndpoint, payload: object, signal?: AbortSignal) => Promise<RpcResult>;

/** The admitted Host endpoint owns the protocol; Client uses DSH's RPC envelope. */
export function createRpc(connection: ClientContext['connection'], clientId: string): CallBridge {
  return async (endpoint, payload, signal) => {
    const result = await connection.rpc.call(CHANNEL, endpoint, { clientId, ...payload }, signal);
    if (!result.ok) throw new Error(result.error.message);
    return result.value as RpcResult;
  };
}
