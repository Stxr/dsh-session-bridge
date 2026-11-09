import { timingSafeEqual } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';

export interface AuthRequest {
  headers: IncomingHttpHeaders;
  socket: { remoteAddress?: string };
}

/** External local callers use their own token, never a DSH browser credential. */
export function authorized(req: AuthRequest, token: string, origin: string): boolean {
  const host = new URL(origin).host;
  if (req.headers.host !== host || req.headers.origin !== undefined
    || req.headers['sec-fetch-site'] === 'cross-site'
    || !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '')) return false;
  const value = req.headers.authorization;
  if (typeof value !== 'string') return false;
  const expected = Buffer.from('Bearer ' + token);
  const actual = Buffer.from(value);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
