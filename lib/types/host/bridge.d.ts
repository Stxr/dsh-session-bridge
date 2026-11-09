import type { BridgeStatus, OpenResult, PreflightStatus, ResultStatus, RpcResult } from '../shared/protocol.js';
import type { Consumer, Job, PollWaiter } from './jobs.js';
export interface BridgeOptions {
    instanceId: string;
    dataDir: string;
    preflight(sessionId: string): PreflightStatus | undefined | Promise<PreflightStatus | undefined>;
    now?: () => number;
}
/** One desktop instance's bounded request queue and authenticated consumer lease. */
export declare class Bridge {
    readonly instanceId: string;
    readonly dataDir: string;
    readonly preflight: BridgeOptions['preflight'];
    readonly now: () => number;
    readonly jobs: Map<string, Job>;
    consumer: Consumer | undefined;
    waiter: PollWaiter | undefined;
    active: Job | undefined;
    disposed: boolean;
    lastResult: OpenResult | undefined;
    constructor({ instanceId, dataDir, preflight, now }: BridgeOptions);
    result(body: unknown, status: ResultStatus, message?: string): OpenResult;
    status(): BridgeStatus;
    finish(job: Job, status: ResultStatus, message?: string): OpenResult;
    submit(body: unknown): Promise<OpenResult>;
    owns(payload: unknown, peerId: string): boolean;
    rpc(endpoint: string, payload: unknown, signal: AbortSignal, peerId: string): Promise<RpcResult>;
    deliver(): void;
    dispose(): void;
    private pruneJobs;
    private poll;
}
