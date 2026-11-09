import type { Dispose } from './context.js';
interface DiscoveryOptions {
    dataDir: string;
    instanceId: string;
    origin: string;
    token: string;
}
/** Publish one private desktop record; an older generation cannot delete a replacement. */
export declare function publishDiscovery({ dataDir, instanceId, origin, token }: DiscoveryOptions, disposeBridge: Dispose): Dispose;
export {};
