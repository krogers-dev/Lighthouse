/** Pure decisions for the read-surfaces-denied lane (find 21).
 *
 * The flow proves that authorization lives in RLS, never in the UI: once
 * the signed-in synthetic account's membership on the selected entity is
 * gone, the next refresh must show the access changed rather than the
 * rows fetched a moment earlier. The revoke has to land MID-FLOW, between
 * "the requests list is on screen" and the refresh tap, and Maestro's
 * only mid-flow hook is a GraalJS runScript with `http` — so the runner
 * (scripts/maestro-denied-runner.mjs) serves a loopback revoke endpoint
 * and restores the membership on every exit path.
 *
 * Everything here is pure so it can be unit-tested in the build container
 * where no device or stack exists. The target is always derived from the
 * canonical synthetic identity matrix, never from an argument the flow
 * could shape: restore therefore puts back exactly what the seed defines,
 * whether or not the revoke response was ever seen.
 */
import { SCOPE, SYNTHETIC_IDENTITIES } from './synthetic-identities.mjs';

export const MEMBERSHIP_COLUMNS = ['user_id', 'environment_id', 'client_id', 'entity_id', 'role'];

/** Adjacent to the totp-helper's 8477: a fixed loopback port, overridable
 * for a machine where it collides. */
export const REVOKE_HELPER_DEFAULT_PORT = 8478;

/** Positive integer port from the environment, or NaN so the caller can
 * refuse to run — garbage must never silently become the default. */
export function helperPort(env = process.env) {
  const raw = env.HIVE_REVOKE_HELPER_PORT;
  if (raw === undefined || raw === '') return REVOKE_HELPER_DEFAULT_PORT;
  if (!/^\d+$/.test(raw)) return NaN;
  const port = Number(raw);
  return port >= 1 && port <= 65535 ? port : NaN;
}

/** Resolve a synthetic account + entity key to the canonical membership
 * rows the seed defines for that pair. Returns { problem } for anything
 * that is not a seeded synthetic identity holding a membership there. */
export function resolveRevokeTarget(
  email,
  entityKey,
  { identities = SYNTHETIC_IDENTITIES, scope = SCOPE } = {},
) {
  const normalized = String(email ?? '')
    .trim()
    .toLowerCase();
  const identity = identities.find((entry) => entry.email === normalized);
  if (!identity) {
    return {
      problem: `${normalized || '(no email given)'} is not a canonical synthetic identity — only example.invalid QA accounts can be revoked`,
    };
  }
  const entityId = scope[entityKey];
  if (
    typeof entityKey !== 'string' ||
    typeof entityId !== 'string' ||
    !entityKey.startsWith('entity')
  ) {
    return { problem: `${JSON.stringify(entityKey)} is not a seeded entity key` };
  }
  const expected = identity.memberships
    .filter(([, entity]) => entity === entityKey)
    .map(([clientKey, entity, role]) => ({
      user_id: identity.id,
      environment_id: scope.environmentId,
      client_id: scope[clientKey],
      entity_id: scope[entity],
      role,
    }));
  if (expected.length === 0) {
    return { problem: `${normalized} holds no seeded membership on ${entityKey}` };
  }
  return { email: normalized, entityKey, userId: identity.id, entityId, expected };
}

/** PostgREST DELETE path for the target, returning the deleted rows. */
export function revokePath(target) {
  return `/memberships?user_id=eq.${target.userId}&entity_id=eq.${target.entityId}&select=${MEMBERSHIP_COLUMNS.join(',')}`;
}

/** PostgREST readback for the target's rows. */
export function readbackPath(target) {
  return `/memberships?user_id=eq.${target.userId}&entity_id=eq.${target.entityId}&select=${MEMBERSHIP_COLUMNS.join(',')}`;
}

/** Restore goes through the seed's own idempotent upsert on the natural
 * key (find 8's canonical shape): existing rows are left alone, missing
 * ones are re-inserted. Never an UPDATE, so the scope-immutability trigger
 * is never in play. */
export const RESTORE_PATH =
  '/memberships?on_conflict=user_id,environment_id,client_id,entity_id,role';
export const RESTORE_PREFER = 'resolution=ignore-duplicates,return=minimal';

export function rowKey(row) {
  return MEMBERSHIP_COLUMNS.map((column) => row[column]).join(':');
}

/** After the revoke, the readback must be empty. */
export function verifyRevoked(readback) {
  if (!Array.isArray(readback)) return ['revoke readback was not a row list'];
  return readback.length === 0
    ? []
    : [`${readback.length} membership row(s) still present after the revoke`];
}

/** After the restore, every expected row must be back, and nothing else
 * may sit on that user/entity pair. */
export function verifyRestored(expected, readback) {
  if (!Array.isArray(readback)) return ['restore readback was not a row list'];
  const present = new Set(readback.map(rowKey));
  const problems = expected
    .filter((row) => !present.has(rowKey(row)))
    .map((row) => `membership ${rowKey(row)} is missing after restore`);
  const wanted = new Set(expected.map(rowKey));
  for (const row of readback) {
    if (!wanted.has(rowKey(row)))
      problems.push(`unexpected membership ${rowKey(row)} after restore`);
  }
  return problems;
}

/** The endpoint answers loopback callers only, like the totp-helper. */
export function isLoopbackAddress(remote) {
  return remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
}

/** A revoke request must name EXACTLY the run's target: the endpoint is
 * single-purpose, and a flow must never be able to point it elsewhere. */
export function parseRevokeRequest(bodyText, target) {
  let parsed;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return { problem: 'body must be JSON' };
  }
  if (typeof parsed !== 'object' || parsed === null) return { problem: 'body must be an object' };
  const user = typeof parsed.user === 'string' ? parsed.user.trim().toLowerCase() : '';
  const entity = typeof parsed.entity === 'string' ? parsed.entity.trim() : '';
  if (user !== target.email || entity !== target.entityKey) {
    return {
      problem: `this run revokes only ${target.email} on ${target.entityKey}; refused ${user || '(no user)'} on ${entity || '(no entity)'}`,
    };
  }
  return { ok: true };
}
