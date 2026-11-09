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
  // Poll keeps v1's identifier coercion; only selectedSessionId is normalized.
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
export function createJob(body: OpenRequest): Job {
  let resolve: (result: OpenResult) => void = () => {};
  const promise = new Promise<OpenResult>(accept => { resolve = accept; });
  return { body: { ...body }, promise, resolve };
}
