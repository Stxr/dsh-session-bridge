import type { OpenRequest, OpenResult, RpcResult } from '../shared/protocol.js';
export interface Job {
    body: OpenRequest;
    promise: Promise<OpenResult>;
    resolve(result: OpenResult): void;
    timer?: ReturnType<typeof setTimeout>;
    result?: OpenResult;
    ready?: boolean;
    clientId?: unknown;
    deliveryToken?: string;
}
export interface Consumer {
    id: unknown;
    peerId: string;
    until: number;
    selectedSessionId: string | null;
}
export interface PollWaiter {
    end(value: RpcResult): void;
    clientId: unknown;
}
/** Allocate a job's promise before installing its expiry timer or publishing it. */
export declare function createJob(body: OpenRequest): Job;
