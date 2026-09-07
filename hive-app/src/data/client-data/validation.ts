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
} from './contract';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ROLES = ['client_user', 'intake', 'preparer', 'reviewer', 'approver'];
const SCOPE_FIELDS = ['environmentId', 'clientId', 'entityId', 'membershipId'];

function requireValid(condition: unknown): asserts condition {
  if (!condition) throw new DataFailure('invalid');
}

function oneOf(value: unknown, allowed: readonly string[]): boolean {
  return typeof value === 'string' && allowed.includes(value);
}

function record(value: unknown): Record<string, unknown> {
  requireValid(value !== null && typeof value === 'object' && !Array.isArray(value));
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  requireValid(
    Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key)),
  );
}

function id(value: unknown): void {
  requireValid(typeof value === 'string' && UUID.test(value));
}

function scope(value: unknown): DataScope {
  const row = record(value);
  exactKeys(row, SCOPE_FIELDS);
  SCOPE_FIELDS.forEach((key) => id(row[key]));
  return row as unknown as DataScope;
}

function textField(value: unknown, limit: number, multiline = false): void {
  requireValid(typeof value === 'string' && value.trim().length > 0 && value.length <= limit);
  requireValid(
    !(multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/).test(
      value,
    ),
  );
}

function date(value: unknown): void {
  requireValid(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value));
  const parsed = new Date(`${value}T00:00:00.000Z`);
  requireValid(Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value);
}

function timestamp(value: unknown): void {
  requireValid(
    typeof value === 'string' &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value),
  );
  date(value.slice(0, 10));
  requireValid(Number.isFinite(Date.parse(value)) && Number(value.slice(11, 13)) < 24);
}

/** Copy JSON before validating, so the caller cannot mutate accepted wire data.
 * The transport must also enforce its own byte limit before buffering a body.
 */
function snapshot(value: unknown): unknown {
  try {
    const json = JSON.stringify(value);
    requireValid(typeof json === 'string' && json.length <= MAX_BODY_CHARS);
    return JSON.parse(json) as unknown;
  } catch {
    throw new DataFailure('invalid');
  }
}

export function parseDataRequest(value: unknown): DataRequest {
  const row = record(snapshot(value));
  requireValid(row.version === CLIENT_DATA_VERSION);
  requireValid(oneOf(row.operation, ['requests.list', 'requests.get', 'connections.qbo']));
  exactKeys(
    row,
    row.operation === 'requests.get'
      ? ['version', 'scope', 'operation', 'requestId']
      : ['version', 'scope', 'operation'],
  );
  scope(row.scope);
  if (row.operation === 'requests.get') id(row.requestId);
  return row as unknown as DataRequest;
}

function requestItem(value: unknown, detail: boolean): Record<string, unknown> {
  const row = record(value);
  const keys = ['id', 'title', 'status', 'ownerRole', 'requestedOn', 'dueOn'];
  exactKeys(row, detail ? [...keys, 'detail'] : keys);
  id(row.id);
  textField(row.title, 500);
  requireValid(oneOf(row.status, ['OPEN', 'ANSWERED', 'CLOSED', 'EXPIRED']));
  requireValid(oneOf(row.ownerRole, ROLES));
  date(row.requestedOn);
  if (row.dueOn !== null) {
    date(row.dueOn);
    // Match public.requests.requests_due_after_requested in the mobile schema.
    requireValid((row.dueOn as string) >= (row.requestedOn as string));
  }
  if (detail) textField(row.detail, 16_384, true);
  return row;
}

export function parseDataReply<O extends Operation>(
  value: unknown,
  expected: DataRequest & { operation: O },
): DataReply<O> {
  const command = parseDataRequest(expected);
  const row = record(snapshot(value));
  requireValid(row.version === CLIENT_DATA_VERSION && row.operation === command.operation);
  requireValid(sameDataScope(scope(row.scope), command.scope));
  if (row.status === 'unavailable') {
    exactKeys(row, ['version', 'scope', 'operation', 'status', 'reason']);
    requireValid(
      oneOf(row.reason, [
        'unsupported',
        'mapping_required',
        'source_unavailable',
        'window_exceeded',
      ]),
    );
    return row as unknown as DataReply<O>;
  }
  requireValid(row.status === 'ok');
  exactKeys(row, ['version', 'scope', 'operation', 'status', 'result']);
  if (command.operation === 'requests.list') {
    const result = record(row.result);
    exactKeys(result, ['items', 'recordedThrough']);
    requireValid(Array.isArray(result.items) && result.items.length <= MAX_REQUESTS);
    const items = result.items.map((item) => requestItem(item, false));
    requireValid(new Set(items.map((item) => item.id)).size === items.length);
    const newest =
      items
        .map((item) => item.requestedOn as string)
        .sort()
        .at(-1) ?? null;
    requireValid(result.recordedThrough === newest);
  } else if (command.operation === 'requests.get') {
    if (row.result !== null) requireValid(requestItem(row.result, true).id === command.requestId);
  } else {
    const result = record(row.result);
    exactKeys(result, ['provider', 'providerEnvironment', 'state', 'lastSyncedAt']);
    requireValid(result.provider === 'quickbooks_online');
    requireValid(
      oneOf(result.state, [
        'active',
        'disconnected',
        'error',
        'pending_company_confirmation',
        'refresh_required',
        'revoked',
        'revoked_local',
        'revoking',
      ]),
    );
    requireValid(
      oneOf(result.providerEnvironment, ['sandbox', 'production']) ||
        (result.providerEnvironment === null &&
          result.state === 'disconnected' &&
          result.lastSyncedAt === null),
    );
    if (result.lastSyncedAt !== null) timestamp(result.lastSyncedAt);
  }
  return row as unknown as DataReply<O>;
}
