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

/** One case in the selected scope, with the single most important
 * attention item and the owned next action attached (WO-002 R1). */
export interface CaseSummary {
  id: string;
  title: string;
  status: CaseStatus;
  statusChangedAt: string;
  attentionSummary: string | null;
  nextActionSummary: string | null;
  nextActionOwnerRole: MembershipRole | null;
  /** How many requests on the case wait on the client (WO-013): what Home
   * derives its guidance from when nothing was authored for the case. */
  openClientRequests: number;
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
  load(scope: ScopeKey): Promise<ScopedList<CaseSummary>>;
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

  /** The scope's cases, newest first (WO-002 R1).
   *
   * Three queries, not one per case: the children are fetched for the
   * whole scope and grouped in memory. A per-case round trip would be an
   * N+1 that grows with the workspace, and every one of those queries
   * would have to repeat the scope triple correctly to stay safe.
   * PostgREST orders each child set newest-first, so the first row seen
   * for a case id is the one to show. */
  async load(scope: ScopeKey): Promise<ScopedList<CaseSummary>> {
    const client = this.getClient();
    try {
      const scoped = <T extends { eq: (c: string, v: string) => T }>(builder: T): T =>
        builder
          .eq('environment_id', scope.environmentId)
          .eq('client_id', scope.clientId)
          .eq('entity_id', scope.entityId);

      const cases = await scoped(
        client.from('cases').select('id, title, status, status_changed_at'),
      ).order('created_at', { ascending: false });
      if (cases.error) throw cases.error;
      if (cases.data.length === 0) return { items: [], recordedThrough: null };

      const attention = await scoped(
        client.from('case_attention_items').select('case_id, summary'),
      ).order('created_at', { ascending: false });
      if (attention.error) throw attention.error;
      const nextActions = await scoped(
        client.from('case_next_actions').select('case_id, summary, owner_role'),
      ).order('created_at', { ascending: false });
      if (nextActions.error) throw nextActions.error;
      // The requests waiting on the client, counted per case (WO-013): the
      // guidance Home derives for a case nobody authored guidance for.
      const openRequests = await scoped(
        client.from('requests').select('case_id, status, owner_role'),
      ).eq('status', 'OPEN');
      if (openRequests.error) throw openRequests.error;
      const openByCase = new Map<string, number>();
      for (const row of openRequests.data) {
        if (row.owner_role !== 'client_user') continue;
        openByCase.set(row.case_id, (openByCase.get(row.case_id) ?? 0) + 1);
      }

      const firstByCase = <T extends { case_id: string }>(rows: readonly T[]): Map<string, T> => {
        const map = new Map<string, T>();
        for (const row of rows) if (!map.has(row.case_id)) map.set(row.case_id, row);
        return map;
      };
      const topAttention = firstByCase(attention.data);
      const topNextAction = firstByCase(nextActions.data);

      const items = cases.data.map((row) => {
        const nextAction = topNextAction.get(row.id);
        return {
          id: row.id,
          title: row.title,
          status: row.status as CaseStatus,
          statusChangedAt: row.status_changed_at,
          attentionSummary: topAttention.get(row.id)?.summary ?? null,
          nextActionSummary: nextAction?.summary ?? null,
          nextActionOwnerRole: (nextAction?.owner_role as MembershipRole | undefined) ?? null,
          openClientRequests: openByCase.get(row.id) ?? 0,
        };
      });
      return { items, recordedThrough: newest(items.map((item) => item.statusChangedAt)) };
    } catch (error) {
      throw mapDbError(error);
    }
  }
}

// ---------------------------------------------------------------------------
// Milestone 1 read surfaces (WO-002 R2, R3)
// ---------------------------------------------------------------------------

export type RequestStatus = 'OPEN' | 'ANSWERED' | 'CLOSED' | 'EXPIRED';

export interface RequestSummary {
  id: string;
  /** The case the request belongs to (WO-013): staff read a case's own
   * requests on the case screen. */
  caseId: string;
  title: string;
  status: RequestStatus;
  ownerRole: MembershipRole;
  requestedOn: string;
  dueOn: string | null;
  /** The request's object version (WO-003, WO-013): a reservation or a
   * close names the version the screen read, and the server refuses a
   * stale one. */
  version: number;
}

export interface RequestDetail extends RequestSummary {
  detail: string;
  /** The document this request is about, when it has one (WO-004): an id
   * inside the scope, resolved by a separate scoped read so a foreign id
   * could never render a name. Seeded only in Milestone 3. */
  subjectDocumentId: string | null;
}

/** Activity is an enumerated vocabulary, never free text: the database
 * stores only these kinds, and the app owns the wording. See the
 * migration comment for why (threat T3). */
export type ActivityEventKind =
  | 'case.status_changed'
  | 'case.intake_recorded'
  | 'request.opened'
  | 'request.answered'
  | 'request.closed'
  | 'request.expired'
  | 'document.received'
  | 'document.checked'
  | 'document.not_accepted'
  | 'document.expired'
  | 'case.package_frozen'
  | 'case.review_started'
  | 'case.review_passed'
  | 'case.returned'
  | 'case.held'
  | 'case.approved'
  | 'case.resumed'
  | 'case.approval_expired'
  | 'source.referenced'
  | 'record.filed'
  | 'record.verified'
  | 'record.mismatch';

export type ActivityActorRole = MembershipRole | 'system';

export interface ActivityEntry {
  id: string;
  kind: ActivityEventKind;
  actorRole: ActivityActorRole;
  occurredAt: string;
}

/** A read result plus the newest SERVER timestamp it contains.
 *
 * `recordedThrough` is deliberately not a "fetched at" clock reading: the
 * device clock is not server truth, and presenting it as such would be a
 * false claim about how current the data is (threat T4). It is the newest
 * server-written timestamp actually present in the payload, so the screen
 * can say what the information is recorded through without inventing
 * anything. Null when there is nothing to be current about. */
export interface ScopedList<T> {
  items: readonly T[];
  recordedThrough: string | null;
}

export interface RequestsLoader {
  list(scope: ScopeKey): Promise<ScopedList<RequestSummary>>;
  get(scope: ScopeKey, requestId: string): Promise<RequestDetail | null>;
}

export interface ActivityLoader {
  list(scope: ScopeKey): Promise<ScopedList<ActivityEntry>>;
}

/** Bounded activity read (R3): a fixed window, never an unbounded scan. */
export const ACTIVITY_WINDOW = 50;

export function newest(values: readonly (string | null)[]): string | null {
  let latest: string | null = null;
  for (const value of values) {
    if (typeof value === 'string' && (latest === null || value > latest)) latest = value;
  }
  return latest;
}

export class RequestsRepository implements ScopedResource, RequestsLoader {
  private unregister: () => void;

  constructor(
    private readonly getClient: ClientAccessor,
    registry: ScopedRegistry,
  ) {
    this.unregister = registry.register(this);
  }

  clear(): void {
    // No cached state: Milestone 1 keeps the no-offline-cache rule.
  }

  dispose(): void {
    this.unregister();
  }

  async list(scope: ScopeKey): Promise<ScopedList<RequestSummary>> {
    const client = this.getClient();
    try {
      const result = await client
        .from('requests')
        .select('id, case_id, title, status, owner_role, requested_on, due_on, version')
        .eq('environment_id', scope.environmentId)
        .eq('client_id', scope.clientId)
        .eq('entity_id', scope.entityId)
        .order('requested_on', { ascending: false });
      if (result.error) throw result.error;
      const items = result.data.map((row) => ({
        id: row.id,
        caseId: row.case_id,
        title: row.title,
        status: row.status as RequestStatus,
        ownerRole: row.owner_role as MembershipRole,
        requestedOn: row.requested_on,
        dueOn: row.due_on,
        version: row.version,
      }));
      return { items, recordedThrough: newest(items.map((item) => item.requestedOn)) };
    } catch (error) {
      throw mapDbError(error);
    }
  }

  /** A request id arriving from a route param is never scope (T5): the
   * query still carries the full scope triple, and RLS filters before it.
   * A foreign id therefore returns no row rather than an error, so the
   * response never confirms that the request exists somewhere else. */
  async get(scope: ScopeKey, requestId: string): Promise<RequestDetail | null> {
    const client = this.getClient();
    try {
      const result = await client
        .from('requests')
        .select(
          'id, case_id, title, detail, status, owner_role, requested_on, due_on, version, subject_document_id',
        )
        .eq('environment_id', scope.environmentId)
        .eq('client_id', scope.clientId)
        .eq('entity_id', scope.entityId)
        .eq('id', requestId)
        .limit(1);
      if (result.error) throw result.error;
      const row = result.data[0];
      if (!row) return null;
      return {
        id: row.id,
        caseId: row.case_id,
        title: row.title,
        detail: row.detail,
        status: row.status as RequestStatus,
        ownerRole: row.owner_role as MembershipRole,
        requestedOn: row.requested_on,
        dueOn: row.due_on,
        version: row.version,
        subjectDocumentId: row.subject_document_id,
      };
    } catch (error) {
      throw mapDbError(error);
    }
  }
}

export class ActivityRepository implements ScopedResource, ActivityLoader {
  private unregister: () => void;

  constructor(
    private readonly getClient: ClientAccessor,
    registry: ScopedRegistry,
  ) {
    this.unregister = registry.register(this);
  }

  clear(): void {
    // No cached state.
  }

  dispose(): void {
    this.unregister();
  }

  async list(scope: ScopeKey): Promise<ScopedList<ActivityEntry>> {
    const client = this.getClient();
    try {
      const result = await client
        .from('activity_events')
        .select('id, event_kind, actor_role, occurred_at')
        .eq('environment_id', scope.environmentId)
        .eq('client_id', scope.clientId)
        .eq('entity_id', scope.entityId)
        .order('occurred_at', { ascending: false })
        .limit(ACTIVITY_WINDOW);
      if (result.error) throw result.error;
      const items = result.data.map((row) => ({
        id: row.id,
        kind: row.event_kind as ActivityEventKind,
        actorRole: row.actor_role as ActivityActorRole,
        occurredAt: row.occurred_at,
      }));
      return { items, recordedThrough: newest(items.map((item) => item.occurredAt)) };
    } catch (error) {
      throw mapDbError(error);
    }
  }
}
