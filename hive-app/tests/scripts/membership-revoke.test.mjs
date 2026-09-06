/** Find 21: the read-surfaces-denied lane's fail-closed decisions — the
 * canonical target, the revoke/restore contracts, and the endpoint's
 * request law — are unit-tested here because the device lane and the
 * stack are both HOLD in this container. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  MEMBERSHIP_COLUMNS,
  RESTORE_PATH,
  RESTORE_PREFER,
  REVOKE_HELPER_DEFAULT_PORT,
  helperPort,
  isLoopbackAddress,
  parseRevokeRequest,
  readbackPath,
  resolveRevokeTarget,
  revokePath,
  rowKey,
  verifyRestored,
  verifyRevoked,
} from '../../scripts/lib/membership-revoke.mjs';
import { SCOPE } from '../../scripts/lib/synthetic-identities.mjs';

const CLIENT_OWNER_ID = 'cccccccc-0000-4000-8000-000000000001';

test('the target resolves from the canonical matrix, never from an argument', () => {
  const target = resolveRevokeTarget('client.owner@example.invalid', 'entityA1');
  assert.equal(target.problem, undefined);
  assert.equal(target.userId, CLIENT_OWNER_ID);
  assert.equal(target.entityId, SCOPE.entityA1);
  // client.owner holds exactly one seeded membership on entityA1, and its
  // restore shape is the seed's five canonical columns, nothing more.
  assert.deepEqual(target.expected, [
    {
      user_id: CLIENT_OWNER_ID,
      environment_id: SCOPE.environmentId,
      client_id: SCOPE.clientA,
      entity_id: SCOPE.entityA1,
      role: 'client_user',
    },
  ]);
  assert.deepEqual(Object.keys(target.expected[0]), MEMBERSHIP_COLUMNS);
  // Case and whitespace normalize like every other synthetic-identity path.
  assert.equal(
    resolveRevokeTarget('  Client.Owner@Example.Invalid ', 'entityA1').userId,
    CLIENT_OWNER_ID,
  );
});

test('NEGATIVE: anything but a seeded synthetic identity with a membership there is refused', () => {
  assert.match(
    resolveRevokeTarget('someone@real-company.com', 'entityA1').problem,
    /not a canonical synthetic identity/,
  );
  assert.match(resolveRevokeTarget('', 'entityA1').problem, /no email given/);
  assert.match(
    resolveRevokeTarget('client.owner@example.invalid', 'clientA').problem,
    /not a seeded entity key/,
  );
  assert.match(
    resolveRevokeTarget('client.owner@example.invalid', 'entityZ9').problem,
    /not a seeded entity key/,
  );
  // A real identity with no membership on that entity: nothing to revoke,
  // and nothing restore could put back.
  assert.match(
    resolveRevokeTarget('client.owner@example.invalid', 'entityB1').problem,
    /no seeded membership on entityB1/,
  );
});

test('revoke and readback address exactly the target pair and return the canonical columns', () => {
  const target = resolveRevokeTarget('client.owner@example.invalid', 'entityA1');
  for (const p of [revokePath(target), readbackPath(target)]) {
    assert.ok(p.startsWith('/memberships?'));
    assert.ok(p.includes(`user_id=eq.${CLIENT_OWNER_ID}`));
    assert.ok(p.includes(`entity_id=eq.${SCOPE.entityA1}`));
    assert.ok(p.includes(`select=${MEMBERSHIP_COLUMNS.join(',')}`));
    // Never a broader filter: the delete must not be able to reach another
    // user's rows or the same user's other entity.
    assert.ok(!p.includes('entity_id=eq.' + SCOPE.entityA2));
  }
});

test("restore is the seed's own idempotent upsert — pinned to the seed source", () => {
  const seed = readFileSync(new URL('../../scripts/seed-local.mjs', import.meta.url), 'utf8');
  assert.ok(seed.includes(RESTORE_PATH), "restore must use the seed's on_conflict path verbatim");
  assert.ok(seed.includes(RESTORE_PREFER), "restore must use the seed's Prefer header verbatim");
  // ignore-duplicates, never merge: an UPDATE would meet the
  // scope-immutability trigger; leaving existing rows untouched cannot.
  assert.ok(RESTORE_PREFER.includes('ignore-duplicates'));
  assert.ok(!RESTORE_PREFER.includes('merge-duplicates'));
});

test('revoke verification demands an empty readback', () => {
  assert.deepEqual(verifyRevoked([]), []);
  assert.equal(verifyRevoked([{ user_id: 'x' }]).length, 1);
  assert.equal(verifyRevoked('not a list').length, 1);
});

test('restore verification demands every expected row back and nothing else on the pair', () => {
  const target = resolveRevokeTarget('client.owner@example.invalid', 'entityA1');
  const row = target.expected[0];
  assert.deepEqual(verifyRestored(target.expected, [row]), []);
  // Column order in the readback does not matter; the natural key does.
  const reordered = {
    role: row.role,
    entity_id: row.entity_id,
    client_id: row.client_id,
    environment_id: row.environment_id,
    user_id: row.user_id,
  };
  assert.deepEqual(verifyRestored(target.expected, [reordered]), []);
  assert.match(verifyRestored(target.expected, []).join('\n'), /missing after restore/);
  assert.match(
    verifyRestored(target.expected, [row, { ...row, role: 'approver' }]).join('\n'),
    /unexpected membership/,
  );
  assert.equal(verifyRestored(target.expected, null).length, 1);
  assert.equal(rowKey(row).split(':').length, MEMBERSHIP_COLUMNS.length);
});

test('the endpoint port is bounded, overridable, and fail-closed on garbage', () => {
  assert.equal(helperPort({}), REVOKE_HELPER_DEFAULT_PORT);
  assert.equal(helperPort({ HIVE_REVOKE_HELPER_PORT: '' }), REVOKE_HELPER_DEFAULT_PORT);
  assert.equal(helperPort({ HIVE_REVOKE_HELPER_PORT: '9000' }), 9000);
  for (const bad of ['soon', '0', '70000', '-1', '80.5', '8478x']) {
    assert.ok(Number.isNaN(helperPort({ HIVE_REVOKE_HELPER_PORT: bad })), `${bad} must be refused`);
  }
  // Adjacent to the totp-helper's 8477, never colliding with it.
  assert.notEqual(REVOKE_HELPER_DEFAULT_PORT, 8477);
});

test('the endpoint serves loopback callers only', () => {
  assert.ok(isLoopbackAddress('127.0.0.1'));
  assert.ok(isLoopbackAddress('::1'));
  assert.ok(isLoopbackAddress('::ffff:127.0.0.1'));
  assert.ok(!isLoopbackAddress('10.0.2.2'));
  assert.ok(!isLoopbackAddress('192.168.1.20'));
  assert.ok(!isLoopbackAddress(''));
});

test("NEGATIVE: a revoke request must name exactly the run's target", () => {
  const target = resolveRevokeTarget('client.owner@example.invalid', 'entityA1');
  const ok = parseRevokeRequest(
    JSON.stringify({ user: ' Client.Owner@example.invalid ', entity: 'entityA1' }),
    target,
  );
  assert.deepEqual(ok, { ok: true });
  // Another seeded user, the same user's other entity, a missing field, or
  // a non-object all fail — the flow can never point the endpoint elsewhere.
  assert.match(
    parseRevokeRequest(
      JSON.stringify({ user: 'intake.beth@example.invalid', entity: 'entityA1' }),
      target,
    ).problem,
    /revokes only/,
  );
  assert.match(
    parseRevokeRequest(
      JSON.stringify({ user: 'client.owner@example.invalid', entity: 'entityA2' }),
      target,
    ).problem,
    /revokes only/,
  );
  assert.match(
    parseRevokeRequest(JSON.stringify({ user: 'client.owner@example.invalid' }), target).problem,
    /revokes only/,
  );
  assert.match(parseRevokeRequest('not json', target).problem, /must be JSON/);
  assert.match(parseRevokeRequest('42', target).problem, /must be an object/);
  assert.match(parseRevokeRequest('null', target).problem, /must be an object/);
});

test('the runner passes the endpoint to the flow through Maestro -e, before the flow file', async () => {
  const { flowArgsWithEnv, SEQUENCE, TARGET_EMAIL, TARGET_ENTITY } =
    await import('../../scripts/maestro-denied-runner.mjs');
  const args = flowArgsWithEnv(
    'read-surfaces-denied.yaml',
    { debugDir: '/tmp/d', testOutputDir: '/tmp/a' },
    { REVOKE_HELPER_URL: 'http://127.0.0.1:8478' },
  );
  const e = args.indexOf('-e');
  assert.ok(e > 0);
  assert.equal(args[e + 1], 'REVOKE_HELPER_URL=http://127.0.0.1:8478');
  assert.ok(args.at(-1).endsWith('read-surfaces-denied.yaml'), 'the flow file stays last');
  assert.ok(args.indexOf('--test-output-dir') < e);
  // The lane signs in first and the target matches what sign-in.yaml types.
  assert.deepEqual(SEQUENCE, ['sign-in.yaml', 'read-surfaces-denied.yaml']);
  assert.equal(TARGET_EMAIL, 'client.owner@example.invalid');
  assert.equal(TARGET_ENTITY, 'entityA1');
  const signIn = readFileSync(new URL('../../.maestro/sign-in.yaml', import.meta.url), 'utf8');
  assert.ok(signIn.includes(`'${TARGET_EMAIL}'`));
});
