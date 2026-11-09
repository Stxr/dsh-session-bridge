/** Public v1 wire protocol; this module has no Host or browser dependencies. */
export const PLUGIN_NAME = '@stxr/dsh-session-bridge';
export const PROTOCOL_VERSION = 1;
export const CHANNEL = '/huantai-session-bridge-v1';
export const OPEN_PATH = '/huantai/session-bridge/v1/open';
export const STATUS_PATH = '/huantai/session-bridge/v1/status';
export const DESKTOP_PAGE = 'dsh-app://app/';
export const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

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

export type ClientStatus = 'opened' | 'archived' | 'load-failed' | 'timeout'
  | 'superseded' | 'not-found' | 'not-ready';
export type ResultStatus = ClientStatus | 'unsupported-target' | 'instance-mismatch' | 'invalid-request';
export type PreflightStatus = 'not-found' | 'unsupported-target' | 'instance-mismatch';
export type ValidationStatus = 'invalid-request' | 'instance-mismatch' | 'timeout';
export type RpcEndpoint = 'poll' | 'authorize' | 'ack' | 'release';

export interface OpenResult {
  protocolVersion: 1;
  // Invalid requests retain their supplied identity fields in the v1 response.
  requestId: unknown;
  sessionId: unknown;
  status: ResultStatus;
  message?: string;
}

export type RpcResult = OpenResult
  | { status: 'request'; request: DeliveredRequest }
  | { status: 'idle' | 'busy' | 'not-ready' | 'released' | 'superseded' | 'authorized' | 'invalid-request' };

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

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function field(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

export function isRpcEndpoint(value: unknown): value is RpcEndpoint {
  return value === 'poll' || value === 'authorize' || value === 'ack' || value === 'release';
}

export function isClientStatus(value: unknown): value is ClientStatus {
  return value === 'opened' || value === 'archived' || value === 'load-failed'
    || value === 'timeout' || value === 'superseded' || value === 'not-found' || value === 'not-ready';
}
