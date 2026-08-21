/** Typed, scope-bound repositories.
 *
 * Every query requires an immutable ScopeKey (constructed only from
 * server-confirmed memberships) and filters by the full scope triple as
 * defense in depth on top of RLS. Repositories register with the scoped
 * registry so identity and scope switches clear all held data.
 */
import { SafeError } from '@/core/errors';
import type { ScopedRegistry, ScopedResource } from '@/tenancy/clearing';
import type { ScopeKey } from '@/tenancy/scope-key';
import type { MembershipRole } from '@/tenancy/types';

import type { HiveSupabaseClient } from './client';

export type CaseStatus =
  | 'DRAFT'
  | 'INTAKE_RECORDED'
  | 'EVIDENCE_PENDING'
  | 'READY_FOR_REVIEW'
  | 'IN_REVIEW'
  | 'APPROVAL_PENDING'
  | 'APPROVED'
  | 'RETURNED'
  | 'HOLD';

export interface DashboardSnapshot {
  caseTitle: string | null;
  caseStatus: CaseStatus | null;
  statusChangedAt: string | null;
  attentionSummary: string | null;
  nextActionSummary: string | null;
  nextActionOwnerRole: MembershipRole | null;
}

interface PostgrestishError {
  code?: string;
  message?: string;
  status?: number;
}

/** Map database-layer failures to safe errors: expired sessions surface as
 * auth_expired (the controller then runs the sign-out sequence), denials as
 * denied, transport problems as network. Internals never pass through. */
export function mapDbError(error: unknown): SafeError {
  if (error instanceof SafeError) return error;
  const e = (error ?? {}) as PostgrestishError;
  const message = typeof e.message === 'string' ? e.message : '';
  if (e.code === 'PGRST301' || e.status === 401 || /jwt|expired/i.test(message)) {
    return new SafeError('auth_expired');
  }
  if (e.code === '42501' || e.status === 403) {
    return new SafeError('denied');
  }
  if (error instanceof TypeError || /network request failed|fetch failed/i.test(message)) {
    return new SafeError('network');
  }
  return new SafeError('unknown');
}

export type ClientAccessor = () => HiveSupabaseClient;

/** What screens depend on; DashboardRepository is the production binding. */
export interface DashboardLoader {
  load(scope: ScopeKey): Promise<DashboardSnapshot>;
}

export class DashboardRepository implements ScopedResource, DashboardLoader {
  private unregister: () => void;

  constructor(
    private readonly getClient: ClientAccessor,
    registry: ScopedRegistry,
  ) {
    this.unregister = registry.register(this);
  }

  /** Repositories hold no cross-scope state; clear is a contract hook so
   * any future memoization is provably wiped on identity/scope change. */
  clear(): void {
    // No cached state in Milestone 0 by design (no offline sensitive cache).
  }

  dispose(): void {
    this.unregister();
  }

  async load(scope: ScopeKey): Promise<DashboardSnapshot> {
    const client = this.getClient();
    try {
      const cases = await client
        .from('cases')
        .select('id, title, status, status_changed_at')
        .eq('environment_id', scope.environmentId)
        .eq('client_id', scope.clientId)
        .eq('entity_id', scope.entityId)
        .order('created_at', { ascending: false })
        .limit(1);
      if (cases.error) throw cases.error;
      const currentCase = cases.data[0] ?? null;
      if (!currentCase) {
        return {
          caseTitle: null,
          caseStatus: null,
          statusChangedAt: null,
          attentionSummary: null,
          nextActionSummary: null,
          nextActionOwnerRole: null,
        };
      }
      const attention = await client
        .from('case_attention_items')
        .select('summary')
        .eq('environment_id', scope.environmentId)
        .eq('client_id', scope.clientId)
        .eq('entity_id', scope.entityId)
        .eq('case_id', currentCase.id)
        .order('created_at', { ascending: false })
        .limit(1);
      if (attention.error) throw attention.error;
      const nextAction = await client
        .from('case_next_actions')
        .select('summary, owner_role')
        .eq('environment_id', scope.environmentId)
        .eq('client_id', scope.clientId)
        .eq('entity_id', scope.entityId)
        .eq('case_id', currentCase.id)
        .order('created_at', { ascending: false })
        .limit(1);
      if (nextAction.error) throw nextAction.error;
      return {
        caseTitle: currentCase.title,
        caseStatus: currentCase.status as CaseStatus,
        statusChangedAt: currentCase.status_changed_at,
        attentionSummary: attention.data[0]?.summary ?? null,
        nextActionSummary: nextAction.data[0]?.summary ?? null,
        nextActionOwnerRole: (nextAction.data[0]?.owner_role as MembershipRole | undefined) ?? null,
      };
    } catch (error) {
      throw mapDbError(error);
    }
  }
}
