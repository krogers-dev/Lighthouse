/** Portable, read-only wire contract shared by the mobile adapter and server.
 * No provider credentials, database clients, native modules or runtime bindings.
 */
export const CLIENT_DATA_VERSION = 'hive.client-data.v1' as const;
export const MAX_REQUESTS = 200;
export const MAX_BODY_CHARS = 262_144;

export interface DataScope {
  readonly environmentId: string;
  readonly clientId: string;
  readonly entityId: string;
  readonly membershipId: string;
}

export type OwnerRole = 'client_user' | 'intake' | 'preparer' | 'reviewer' | 'approver';
export interface RequestSummary {
  id: string;
  title: string;
  status: 'OPEN' | 'ANSWERED' | 'CLOSED' | 'EXPIRED';
  ownerRole: OwnerRole;
  requestedOn: string;
  dueOn: string | null;
}
export interface RequestDetail extends RequestSummary {
  detail: string;
}
export interface RequestList {
  items: readonly RequestSummary[];
  recordedThrough: string | null;
}

/** Operational metadata only. A connection is not evidence of completed books. */
export interface QboConnection {
  provider: 'quickbooks_online';
  providerEnvironment: 'sandbox' | 'production' | null;
  state:
    | 'active'
    | 'disconnected'
    | 'error'
    | 'pending_company_confirmation'
    | 'refresh_required'
    | 'revoked'
    | 'revoked_local'
    | 'revoking';
  lastSyncedAt: string | null;
}

export interface OperationResults {
  'requests.list': RequestList;
  'requests.get': RequestDetail | null;
  'connections.qbo': QboConnection;
}
export type Operation = keyof OperationResults;
export type DataRequest = {
  version: typeof CLIENT_DATA_VERSION;
  scope: DataScope;
} & (
  | { operation: 'requests.list' | 'connections.qbo' }
  | { operation: 'requests.get'; requestId: string }
);

export type UnavailableReason =
  'unsupported' | 'mapping_required' | 'source_unavailable' | 'window_exceeded';
export type DataReply<O extends Operation> = {
  version: typeof CLIENT_DATA_VERSION;
  scope: DataScope;
  operation: O;
} & (
  | { status: 'ok'; result: OperationResults[O] }
  | { status: 'unavailable'; reason: UnavailableReason }
);

export type DataFailureCode = 'invalid' | 'unauthorized' | 'denied' | 'unavailable';
export class DataFailure extends Error {
  constructor(readonly code: DataFailureCode) {
    super('Client data could not be read.');
    this.name = 'DataFailure';
  }
}

export function sameDataScope(a: DataScope, b: DataScope): boolean {
  return (
    a.environmentId === b.environmentId &&
    a.clientId === b.clientId &&
    a.entityId === b.entityId &&
    a.membershipId === b.membershipId
  );
}
