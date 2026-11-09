import type { IncomingHttpHeaders } from 'node:http';
export interface AuthRequest {
    headers: IncomingHttpHeaders;
    socket: {
        remoteAddress?: string;
    };
}
/** External local callers use their own token, never a DSH browser credential. */
export declare function authorized(req: AuthRequest, token: string, origin: string): boolean;
