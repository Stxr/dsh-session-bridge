/** Public v1 wire protocol; this module has no Host or browser dependencies. */
export declare const PLUGIN_NAME = "@stxr/dsh-session-bridge";
export declare const PROTOCOL_VERSION = 1;
export declare const CHANNEL = "/huantai-session-bridge-v1";
export declare const OPEN_PATH = "/huantai/session-bridge/v1/open";
export declare const STATUS_PATH = "/huantai/session-bridge/v1/status";
export declare const DESKTOP_PAGE = "dsh-app://app/";
export declare const ID_PATTERN: RegExp;
export interface OpenRequest {
    protocolVersion: 1;
    instanceId: string;
    requestId: string;
    sessionId: string;
    dataDir: string;
    expiresAt: number;
}
export interface DeliveredRequest extends OpenRequest {
    deliveryToken: string;
}
export type ClientStatus = 'opened' | 'archived' | 'load-failed' | 'timeout' | 'superseded' | 'not-found' | 'not-ready';
export type ResultStatus = ClientStatus | 'unsupported-target' | 'instance-mismatch' | 'invalid-request';
export type PreflightStatus = 'not-found' | 'unsupported-target' | 'instance-mismatch';
export type ValidationStatus = 'invalid-request' | 'instance-mismatch' | 'timeout';
export type RpcEndpoint = 'poll' | 'authorize' | 'ack' | 'release';
export interface OpenResult {
    protocolVersion: 1;
    requestId: unknown;
    sessionId: unknown;
    status: ResultStatus;
    message?: string;
}
export type RpcResult = OpenResult | {
    status: 'request';
    request: DeliveredRequest;
} | {
    status: 'idle' | 'busy' | 'not-ready' | 'released' | 'superseded' | 'authorized' | 'invalid-request';
};
export interface BridgeStatus {
    protocolVersion: 1;
    instanceId: string;
    profile: 'desktop';
    dataDir: string;
    ready: boolean;
    selectedSessionId: string | null;
    lastResult: OpenResult | null;
}
export interface DiscoveryRecord {
    protocolVersion: 1;
    instanceId: string;
    pid: number;
    profile: 'desktop';
    dataDir: string;
    endpoint: string;
    token: string;
    startedAt: number;
}
export declare function isRecord(value: unknown): value is Record<string, unknown>;
export declare function field(value: unknown, key: string): unknown;
export declare function isRpcEndpoint(value: unknown): value is RpcEndpoint;
export declare function isClientStatus(value: unknown): value is ClientStatus;
