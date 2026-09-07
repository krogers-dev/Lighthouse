/** Optional native read adapter. The composition root still uses direct
 * repositories until the server mapping and authorization gates pass.
 * This layer never acquires, stores or forwards a session or provider token.
 */
import { SafeError, toSafeError } from '@/core/errors';
import type { RequestsLoader } from '@/data/supabase/repositories';
import type { ClearReason, ScopedRegistry, ScopedResource } from '@/tenancy/clearing';
import { scopeKeyEquals, type ScopeKey } from '@/tenancy/scope-key';

import {
  CLIENT_DATA_VERSION,
  DataFailure,
  type DataRequest,
  type Operation,
  type OperationResults,
} from './contract';
import { parseDataReply, parseDataRequest } from './validation';

export interface ClientDataTransport {
  /** Acquire authorization separately for each call; do not retain tokens. */
  execute(request: DataRequest, signal: AbortSignal): Promise<unknown>;
}

export interface ClientDataAccess {
  readonly scope: ScopeKey;
  readonly actorId: string;
}

function safeFailure(error: unknown): SafeError {
  if (error instanceof DataFailure) {
    if (error.code === 'unauthorized') return new SafeError('auth_expired');
    if (error.code === 'denied') return new SafeError('denied');
    return new SafeError('unavailable');
  }
  return toSafeError(error);
}

export class ClientDataAdapter implements RequestsLoader, ScopedResource {
  private readonly unregister: () => void;
  private readonly pending = new Set<AbortController>();
  private epoch = 0;
  private disposed = false;

  constructor(
    private readonly transport: ClientDataTransport,
    private readonly getAccess: () => ClientDataAccess,
    registry: ScopedRegistry,
  ) {
    this.unregister = registry.register(this);
  }

  clear(_reason: ClearReason): void {
    this.epoch += 1;
    for (const controller of this.pending) controller.abort();
    this.pending.clear();
  }

  dispose(): void {
    this.disposed = true;
    this.clear('sign_out');
    this.unregister();
  }

  list(scope: ScopeKey): Promise<OperationResults['requests.list']> {
    return this.read(scope, { operation: 'requests.list' });
  }

  get(scope: ScopeKey, requestId: string): Promise<OperationResults['requests.get']> {
    return this.read(scope, { operation: 'requests.get', requestId });
  }

  getQboConnection(scope: ScopeKey): Promise<OperationResults['connections.qbo']> {
    return this.read(scope, { operation: 'connections.qbo' });
  }

  private currentAccess(): ClientDataAccess {
    if (this.disposed) throw new SafeError('stale_scope');
    try {
      const access = this.getAccess();
      if (!access || typeof access.actorId !== 'string' || !access.actorId.trim()) {
        throw new SafeError('auth_expired');
      }
      return access;
    } catch (error) {
      throw safeFailure(error);
    }
  }

  private assertCurrent(snapshot: ClientDataAccess, epoch: number): void {
    if (this.disposed || epoch !== this.epoch) throw new SafeError('stale_scope');
    const current = this.currentAccess();
    if (current.actorId !== snapshot.actorId || !scopeKeyEquals(current.scope, snapshot.scope)) {
      throw new SafeError('stale_scope');
    }
  }

  private async read<O extends Operation>(
    scope: ScopeKey,
    selection: O extends 'requests.get' ? { operation: O; requestId: string } : { operation: O },
  ): Promise<OperationResults[O]> {
    let snapshot: ClientDataAccess | null = null;
    const epoch = this.epoch;
    const controller = new AbortController();
    let onAbort: (() => void) | undefined;
    try {
      const access = this.currentAccess();
      if (!scopeKeyEquals(access.scope, scope)) throw new SafeError('stale_scope');
      snapshot = { actorId: access.actorId, scope: Object.freeze({ ...access.scope }) };
      const request = parseDataRequest({
        version: CLIENT_DATA_VERSION,
        scope: {
          environmentId: snapshot.scope.environmentId,
          clientId: snapshot.scope.clientId,
          entityId: snapshot.scope.entityId,
          membershipId: snapshot.scope.membershipId,
        },
        ...selection,
      }) as DataRequest & { operation: O };
      Object.freeze(request.scope);
      Object.freeze(request);
      this.assertCurrent(snapshot, epoch);
      this.pending.add(controller);
      const cancelled = new Promise<never>((_resolve, reject) => {
        onAbort = () => reject(new SafeError('stale_scope'));
        controller.signal.addEventListener('abort', onAbort, { once: true });
      });
      // Cancellation settles the caller even if a transport ignores the
      // signal. The epoch/access checks also reject every late response.
      const value = await Promise.race([
        this.transport.execute(request, controller.signal),
        cancelled,
      ]);
      this.assertCurrent(snapshot, epoch);
      const reply = parseDataReply<O>(value, request);
      this.assertCurrent(snapshot, epoch);
      if (reply.status !== 'ok') throw new SafeError('unavailable');
      return reply.result;
    } catch (error) {
      if (snapshot) this.assertCurrent(snapshot, epoch);
      throw safeFailure(error);
    } finally {
      if (onAbort) controller.signal.removeEventListener('abort', onAbort);
      this.pending.delete(controller);
    }
  }
}
