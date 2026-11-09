import type { ValidationStatus } from '../shared/protocol.js';
/** Validate the exact v1 request, retaining its existing 16-second clock tolerance. */
export declare function validRequest(body: unknown, instanceId: string, dataDir: string, now?: number): ValidationStatus | undefined;
