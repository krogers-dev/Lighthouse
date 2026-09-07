/** Read-only integration service. This module is NOT a deployed endpoint.
 * Production assembly must supply the authorization and source ports below.
 * Never implement them with client-provided bindings, synthetic authorization,
 * or an unrestricted service-role query. No identities or provider secrets are
 * included in the wire result, and upstream errors are never forwarded.
 */
import {
  CLIENT_DATA_VERSION,
  DataFailure,
  MAX_BODY_CHARS,
  MAX_REQUESTS,
  sameDataScope,
  type DataReply,
  type DataRequest,
  type DataScope,
  type Operation,
  type OwnerRole,
  type RequestDetail,
  type RequestSummary,
  type UnavailableReason,
} from './contract';
import { parseDataReply, parseDataRequest } from './validation';

export interface ApprovedMapping {
  readonly actorId: string;
  readonly scope: DataScope;
  readonly sourceProjectId: string;
  readonly sourceEntityId: string;
  readonly providerEnvironment: 'sandbox' | 'production';
  readonly timezone: string;
  readonly active: boolean;
  readonly mappingApproved: boolean;
  readonly aal: 'aal1' | 'aal2';
  readonly sessionActive: boolean;
  readonly profileActive: boolean;
  readonly membershipActive: boolean;
  readonly entitlementActive: boolean;
}

export interface AuthorizationPort {
  /** Verify token issuer, audience, signature, expiry, and the live session.
   * Resolve the exact actor and FULL requested scope from current server-owned
   * membership, profile, entitlement and approved binding records. Require AAL2
   * for every caller. Never infer roles from names or user-editable metadata.
   * Throw DataFailure('unauthorized'/'denied') for failed access checks. Return
   * null ONLY after successful authorization when an approved source mapping
   * does not exist. This is re-evaluated on every read; no cached authorization.
   */
  authorize(sessionToken: string, request: DataRequest): Promise<ApprovedMapping | null>;
}

export interface SourceEnvelope {
  readonly sourceProjectId: string;
  readonly sourceEntityId: string;
  readonly providerEnvironment: 'sandbox' | 'production';
  readonly value: unknown;
}

export interface SourcePort {
  /** Query only the approved fixed project/entity with a user-scoped client and
   * its RLS (or an equivalently narrow server routine). Recheck revoked access,
   * apply source visibility rules, and bound bytes/time as well as row count.
   * The source must honor limit and return up to MAX_REQUESTS+1 so the service
   * can refuse truncation. Do not silently cap at MAX_REQUESTS or paginate only
   * part of the result. Every row includes entity_id. Explicit presentation
   * metadata comes from approved server records, never a caller input:
   * {approved:true, ownerRole, requestedOn}. created_at is NOT requestedOn.
   */
  listRequests(mapping: ApprovedMapping, options: { limit: number }): Promise<SourceEnvelope>;
  /** Query by entity AND request ID. Missing/foreign IDs return value:null. */
  getRequest(mapping: ApprovedMapping, requestId: string): Promise<SourceEnvelope>;
  /** Existing hive-qbo GET status response wrapped as {integration:{...}}.
   * Never query Vault, token storage or the private audit log for this surface.
   */
  getQboConnection(mapping: ApprovedMapping): Promise<SourceEnvelope>;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const roles = new Set<OwnerRole>(['client_user', 'intake', 'preparer', 'reviewer', 'approver']);
const statuses = { open: 'OPEN', answered: 'ANSWERED', closed: 'CLOSED' } as const;
const connectionStates = new Set([
  'active',
  'disconnected',
  'error',
  'pending_company_confirmation',
  'refresh_required',
  'revoked',
  'revoked_local',
  'revoking',
]);
const connectionKeys = new Set([
  'entityId',
  'provider',
  'environment',
  'status',
  'companyName',
  'confirmationVersion',
  'canConfirmCompany',
  'lastSyncedAt',
  'lastWebhookAt',
  'lastCdcAt',
  'lastErrorCode',
  'nextSyncAfter',
  'updatedAt',
]);
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function dateOnly(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function timestamp(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value,
    ) &&
    dateOnly(value.slice(0, 10)) &&
    Number.isFinite(Date.parse(value))
  );
}
class SourceProblem extends Error {
  constructor(readonly reason: UnavailableReason) {
    super('Source unavailable.');
  }
}
function sourceProblem(reason: UnavailableReason = 'source_unavailable'): never {
  throw new SourceProblem(reason);
}

function approvedMapping(value: ApprovedMapping, request: DataRequest): ApprovedMapping {
  if (
    !record(value) ||
    !record(value.scope) ||
    !sameDataScope(value.scope, request.scope) ||
    value.active !== true ||
    value.mappingApproved !== true ||
    value.aal !== 'aal2' ||
    value.sessionActive !== true ||
    value.profileActive !== true ||
    value.membershipActive !== true ||
    value.entitlementActive !== true ||
    typeof value.actorId !== 'string' ||
    !uuid.test(value.actorId) ||
    typeof value.sourceEntityId !== 'string' ||
    !uuid.test(value.sourceEntityId) ||
    typeof value.sourceProjectId !== 'string' ||
    !/^[a-z0-9]{20}$/.test(value.sourceProjectId) ||
    !['sandbox', 'production'].includes(value.providerEnvironment) ||
    typeof value.timezone !== 'string'
  ) {
    throw new DataFailure('denied');
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value.timezone }).format(0);
  } catch {
    throw new DataFailure('denied');
  }
  return Object.freeze({ ...value, scope: Object.freeze({ ...value.scope }) });
}

function sourceValue(envelope: SourceEnvelope, mapping: ApprovedMapping): unknown {
  if (
    !record(envelope) ||
    envelope.sourceProjectId !== mapping.sourceProjectId ||
    envelope.sourceEntityId !== mapping.sourceEntityId ||
    envelope.providerEnvironment !== mapping.providerEnvironment
  )
    sourceProblem();
  return envelope.value;
}

function projectRequest(value: unknown, mapping: ApprovedMapping): RequestDetail | null {
  if (!record(value) || value.entity_id !== mapping.sourceEntityId) sourceProblem();
  if (value.status === 'draft') return null;
  if (
    typeof value.status !== 'string' ||
    !Object.prototype.hasOwnProperty.call(statuses, value.status)
  ) {
    sourceProblem('unsupported');
  }
  const presentation = value.presentation;
  if (
    !record(presentation) ||
    presentation.approved !== true ||
    !roles.has(presentation.ownerRole as OwnerRole) ||
    !dateOnly(presentation.requestedOn)
  ) {
    sourceProblem('mapping_required');
  }
  let dueOn: string | null = null;
  if (value.due_at !== null) {
    if (!timestamp(value.due_at)) sourceProblem();
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: mapping.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date(value.due_at));
    const part = (type: string) => parts.find((p) => p.type === type)?.value;
    dueOn = `${part('year')}-${part('month')}-${part('day')}`;
    // Preserve requests_due_after_requested in
    // supabase/migrations/20260822120006_milestone1_read_surfaces.sql.
    if (!dateOnly(dueOn) || dueOn < presentation.requestedOn) sourceProblem();
  }
  if (
    typeof value.id !== 'string' ||
    !uuid.test(value.id) ||
    typeof value.title !== 'string' ||
    typeof value.reason !== 'string'
  )
    sourceProblem();
  return {
    id: value.id,
    title: value.title,
    detail: value.reason,
    status: statuses[value.status as keyof typeof statuses],
    ownerRole: presentation.ownerRole as OwnerRole,
    requestedOn: presentation.requestedOn,
    dueOn,
  };
}

function projectConnection(value: unknown, mapping: ApprovedMapping) {
  if (
    !record(value) ||
    Object.keys(value).some((key) => key !== 'integration') ||
    !record(value.integration)
  )
    sourceProblem();
  const row = value.integration;
  if (
    Object.keys(row).some((key) => !connectionKeys.has(key)) ||
    row.entityId !== mapping.sourceEntityId ||
    row.provider !== 'quickbooks_online' ||
    typeof row.status !== 'string' ||
    !connectionStates.has(row.status)
  )
    sourceProblem();
  const environment = row.environment ?? null;
  if (
    environment !== mapping.providerEnvironment &&
    !(row.status === 'disconnected' && environment === null)
  )
    sourceProblem();
  if (row.lastSyncedAt != null && !timestamp(row.lastSyncedAt)) sourceProblem();
  return {
    provider: 'quickbooks_online',
    providerEnvironment: environment,
    state: row.status,
    lastSyncedAt: row.lastSyncedAt ?? null,
  };
}

export function createClientDataService(ports: {
  authorization: AuthorizationPort;
  source: SourcePort;
}) {
  return {
    async read(sessionToken: string, input: unknown): Promise<DataReply<Operation>> {
      const request = parseDataRequest(input);
      if (
        typeof sessionToken !== 'string' ||
        !sessionToken.trim() ||
        sessionToken.length > 16_384
      ) {
        throw new DataFailure('unauthorized');
      }
      const header = {
        version: CLIENT_DATA_VERSION,
        scope: request.scope,
        operation: request.operation,
      };
      const unavailable = (reason: UnavailableReason): DataReply<Operation> => ({
        ...header,
        status: 'unavailable',
        reason,
      });
      let mapping: ApprovedMapping;
      try {
        const authorized = await ports.authorization.authorize(sessionToken, request);
        if (authorized === null) return unavailable('mapping_required');
        mapping = approvedMapping(authorized, request);
      } catch (error) {
        throw new DataFailure(error instanceof DataFailure ? error.code : 'unauthorized');
      }

      try {
        let result: unknown;
        if (request.operation === 'requests.list') {
          const rows = sourceValue(
            await ports.source.listRequests(mapping, { limit: MAX_REQUESTS + 1 }),
            mapping,
          );
          if (!Array.isArray(rows)) sourceProblem();
          if (rows.length > MAX_REQUESTS) sourceProblem('window_exceeded');
          const items: RequestSummary[] = [];
          for (const row of rows) {
            const projected = projectRequest(row, mapping);
            if (projected) {
              const { detail: _detail, ...summary } = projected;
              items.push(summary);
            }
          }
          items.sort(
            (a, b) => b.requestedOn.localeCompare(a.requestedOn) || a.id.localeCompare(b.id),
          );
          result = {
            items,
            recordedThrough: items.reduce<string | null>(
              (latest, row) =>
                latest === null || row.requestedOn > latest ? row.requestedOn : latest,
              null,
            ),
          };
        } else if (request.operation === 'requests.get') {
          const row = sourceValue(
            await ports.source.getRequest(mapping, request.requestId),
            mapping,
          );
          result =
            row === null ||
            (record(row) &&
              (row.entity_id !== mapping.sourceEntityId || row.id !== request.requestId))
              ? null
              : projectRequest(row, mapping);
        } else {
          result = projectConnection(
            sourceValue(await ports.source.getQboConnection(mapping), mapping),
            mapping,
          );
        }
        const reply = { ...header, status: 'ok', result };
        if (JSON.stringify(reply).length > MAX_BODY_CHARS) sourceProblem('window_exceeded');
        return parseDataReply(reply, request);
      } catch (error) {
        if (error instanceof DataFailure && ['unauthorized', 'denied'].includes(error.code)) {
          throw new DataFailure(error.code);
        }
        return unavailable(error instanceof SourceProblem ? error.reason : 'source_unavailable');
      }
    },
  };
}
