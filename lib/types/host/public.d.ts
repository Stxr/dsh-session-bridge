/** Standalone broker exports used by callers and behavior tests. */
export { Bridge } from './bridge.js';
export type { BridgeOptions } from './bridge.js';
export { authorized } from './auth.js';
export { validRequest } from './validation.js';
export { CHANNEL, OPEN_PATH, STATUS_PATH } from '../shared/protocol.js';
export type { BridgeStatus, DeliveredRequest, DiscoveryRecord, OpenRequest, OpenResult, ResultStatus, RpcResult, } from '../shared/protocol.js';
