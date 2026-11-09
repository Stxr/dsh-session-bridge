import { ID_PATTERN, isRecord } from '../shared/protocol.js';
import type { ValidationStatus } from '../shared/protocol.js';

const REQUEST_FIELDS = new Set(['protocolVersion', 'instanceId', 'requestId', 'sessionId', 'dataDir', 'expiresAt']);

/** Validate the exact v1 request, retaining its existing 16-second clock tolerance. */
export function validRequest(body: unknown, instanceId: string, dataDir: string, now = Date.now()): ValidationStatus | undefined {
  if (!isRecord(body) || Array.isArray(body)
    || Object.keys(body).some(key => !REQUEST_FIELDS.has(key))
    || body.protocolVersion !== 1
    || typeof body.requestId !== 'string' || !ID_PATTERN.test(body.requestId)
    || typeof body.sessionId !== 'string' || !ID_PATTERN.test(body.sessionId)
    || typeof body.expiresAt !== 'number' || !Number.isSafeInteger(body.expiresAt)
    || body.expiresAt > now + 16000) return 'invalid-request';
  if (body.instanceId !== instanceId || body.dataDir !== dataDir) return 'instance-mismatch';
  if (body.expiresAt <= now) return 'timeout';
  return undefined;
}
