export type Dispose = () => void;
export interface SnapshotSource<Value> {
    getSnapshot(): Value;
    subscribe(listener: () => void): Dispose;
}
export interface SessionRow {
    id: string;
    retainedBy?: {
        mainView?: number;
    };
}
export interface SessionList {
    phase: string;
    byId: Readonly<Record<string, SessionRow | undefined>>;
}
export interface WorkspaceList {
    phase: string;
    archivedSessionIds: readonly string[];
}
interface SessionReference {
    ready: Promise<{
        session: SnapshotSource<{
            removed: boolean;
            openState: string;
        }>;
    }>;
}
/** DSH 0.2.2 Client services used by polling and session selection. */
export interface ClientContext {
    connection: {
        state: SnapshotSource<string>;
        rpc: {
            call(channel: string, endpoint: string, payload: unknown, signal?: AbortSignal): Promise<{
                ok: true;
                value: unknown;
            } | {
                ok: false;
                error: {
                    message: string;
                };
            }>;
        };
    };
    sessions: {
        list: SnapshotSource<SessionList>;
        retainInfo(sessionId: string): SnapshotSource<{
            retainedBy: {
                mainView?: number;
            };
        }>;
        using<Value>(sessionId: string, options: {
            source: 'controllerOperation';
            signal: AbortSignal;
        }, operation: (reference: SessionReference) => Value | Promise<Value>): Promise<Value>;
    };
    workspaces: {
        list: SnapshotSource<WorkspaceList>;
    };
    layout: {
        beginNavigation(): void;
    };
    uiWorkspace: {
        openSession(sessionId: string): void;
    };
    effect(execute: () => Dispose): unknown;
}
export {};
