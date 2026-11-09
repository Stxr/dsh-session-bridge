import type { IncomingMessage, ServerResponse } from 'node:http';

export type Dispose = () => void;

export interface HostRoute {
  kind: 'exact' | 'prefix';
  path: string;
  handler(req: IncomingMessage, res: ServerResponse): void | Promise<void>;
}

export interface SessionHeader {
  origin?: string;
}

/** Structural subset of the DSH 0.2.2 Host services this plugin actually uses. */
export interface HostContext {
  get(key: 'profileContext'): { name: string; home?: string } | undefined;
  effect(execute: () => Dispose): unknown;
  webServer: {
    getOrigin(): string;
    register(route: HostRoute): Dispose;
  };
  connection: {
    admit(req: IncomingMessage):
      | { rejection: number }
      | { peer: { id: string; principal: { kind: string } } };
  };
  sessions: {
    get(sessionId: string): { header: SessionHeader } | undefined;
  };
  sessionPersistence: {
    stat(sessionId: string): Promise<{
      header?: SessionHeader;
      location?: { path?: string };
    } | undefined>;
  };
}
