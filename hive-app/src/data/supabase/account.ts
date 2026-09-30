/** The person's own account controls (WO-007): the deletion request.
 *
 * Not scope-bound: a request is about the person, not a workspace, and
 * the server audits it in every scope the person holds. The repository
 * reads the person's own latest request (the policy admits nothing else)
 * and asks the server to record or withdraw one with a phone-made
 * idempotency key; the server decides everything else and answers with
 * tokens the screen words. Nothing here deletes anything: completion is
 * the server role's, through the operator tooling. */
import { SafeError } from '@/core/errors';
import type { ScopedRegistry, ScopedResource } from '@/tenancy/clearing';

import { type ClientAccessor, mapDbError } from './repositories';

export type DeletionStatus = 'REQUESTED' | 'WITHDRAWN' | 'COMPLETED';

export interface DeletionRequest {
  id: string;
  status: DeletionStatus;
  requestedAt: string;
  withdrawnAt: string | null;
  completedAt: string | null;
}

export interface DeletionReceipt {
  requestId: string;
  status: DeletionStatus;
  replayed: boolean;
}

export interface AccountLoader {
  /** The person's latest deletion request of any status, or null. */
  getLatestDeletionRequest(): Promise<DeletionRequest | null>;
}

export interface AccountWriter {
  requestDeletion(idempotencyKey: string): Promise<DeletionReceipt>;
  withdrawDeletion(idempotencyKey: string): Promise<DeletionReceipt>;
}

export const ACCOUNT_REFUSALS = [
  'already_requested',
  'no_open_request',
  'invalid_idempotency_key',
] as const;

export type AccountRefusal = (typeof ACCOUNT_REFUSALS)[number];

export class AccountRefusedError extends Error {
  constructor(readonly refusal: AccountRefusal) {
    super(refusal);
    this.name = 'AccountRefusedError';
  }
}

function isRefusal(value: string): value is AccountRefusal {
  return (ACCOUNT_REFUSALS as readonly string[]).includes(value);
}

function isStatus(value: string): value is DeletionStatus {
  return value === 'REQUESTED' || value === 'WITHDRAWN' || value === 'COMPLETED';
}

/** A P0001 with a known token is a refusal; everything else is the safe
 * error the rest of the app already words. */
export function mapAccountError(error: unknown): AccountRefusedError | SafeError {
  if (typeof error === 'object' && error !== null) {
    const record = error as { code?: unknown; message?: unknown };
    if (
      record.code === 'P0001' &&
      typeof record.message === 'string' &&
      isRefusal(record.message)
    ) {
      return new AccountRefusedError(record.message);
    }
  }
  return mapDbError(error);
}

function decodeReceipt(value: unknown): DeletionReceipt {
  if (typeof value !== 'object' || value === null) throw new SafeError('unknown');
  const v = value as Record<string, unknown>;
  const status = v['status'];
  if (typeof v['request_id'] !== 'string' || typeof status !== 'string' || !isStatus(status)) {
    throw new SafeError('unknown');
  }
  return { requestId: v['request_id'], status, replayed: v['replayed'] === true };
}

export class AccountRepository implements ScopedResource, AccountLoader, AccountWriter {
  private unregister: () => void;

  constructor(
    private readonly getClient: ClientAccessor,
    registry: ScopedRegistry,
  ) {
    this.unregister = registry.register(this);
  }

  clear(): void {
    // No cached state: the request lives on the server, never on the device.
  }

  dispose(): void {
    this.unregister();
  }

  async getLatestDeletionRequest(): Promise<DeletionRequest | null> {
    const client = this.getClient();
    try {
      const result = await client
        .from('account_deletion_requests')
        .select('id, status, requested_at, withdrawn_at, completed_at')
        .order('requested_at', { ascending: false })
        .limit(1);
      if (result.error) throw result.error;
      const row = result.data[0];
      if (!row || !isStatus(row.status)) return null;
      return {
        id: row.id,
        status: row.status,
        requestedAt: row.requested_at,
        withdrawnAt: row.withdrawn_at,
        completedAt: row.completed_at,
      };
    } catch (error) {
      throw mapDbError(error);
    }
  }

  async requestDeletion(idempotencyKey: string): Promise<DeletionReceipt> {
    return this.call('request_account_deletion', idempotencyKey);
  }

  async withdrawDeletion(idempotencyKey: string): Promise<DeletionReceipt> {
    return this.call('withdraw_account_deletion', idempotencyKey);
  }

  private async call(
    name: 'request_account_deletion' | 'withdraw_account_deletion',
    idempotencyKey: string,
  ): Promise<DeletionReceipt> {
    const client = this.getClient();
    try {
      const result = await client.rpc(name, { p_idempotency_key: idempotencyKey });
      if (result.error) throw result.error;
      return decodeReceipt(result.data);
    } catch (error) {
      throw error instanceof SafeError ? error : mapAccountError(error);
    }
  }
}
