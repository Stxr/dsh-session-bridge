import { randomBytes, randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { Bridge } from './bridge.js';
import type { HostContext } from './context.js';
import { publishDiscovery } from './discovery.js';
import { registerRoutes } from './http.js';

export const inject = ['webServer', 'connection', 'sessionPersistence', 'sessions', 'profileContext'];

/** Desktop Host entry; web profiles never own discovery or bridge routes. */
export function apply(ctx: HostContext): void {
  const profile = ctx.get('profileContext');
  if (profile?.name !== 'desktop') return;
  const root = profile.home || process.env.DSH_HOME || join(homedir(), '.dsh');
  if (!isAbsolute(root)) throw new Error('Huantai bridge requires an absolute DSH_HOME');
  const dataDir = realpathSync(root);
  const origin = ctx.webServer.getOrigin();
  const url = new URL(origin);
  if (url.hostname !== '127.0.0.1' || url.protocol !== 'http:') throw new Error('Huantai bridge requires a loopback HTTP Host');
  const instanceId = randomUUID();
  const token = randomBytes(32).toString('hex');
  const bridge = new Bridge({ instanceId, dataDir, preflight: async sessionId => {
    const live = ctx.sessions.get(sessionId);
    const stored = await ctx.sessionPersistence.stat(sessionId);
    const header = live?.header ?? stored?.header;
    if (!header) return 'not-found';
    if (header.origin === 'subagent') return 'unsupported-target';
    // Refuse a customized persistence root that disagrees with the scanned directory.
    if (stored?.location?.path && !resolve(stored.location.path).startsWith(join(dataDir, 'sessions') + '/')) {
      return 'instance-mismatch';
    }
    return undefined;
  } });
  ctx.effect(() => publishDiscovery({ dataDir, instanceId, origin, token }, () => bridge.dispose()));
  registerRoutes(ctx, bridge, token, origin);
}

export type { HostContext } from './context.js';
