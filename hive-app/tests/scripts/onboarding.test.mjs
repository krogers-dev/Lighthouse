import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { confirmationError, loadHostedManifest } from '../../scripts/lib/hosted-targets.mjs';
import {
  LOCAL_ONBOARDING_RULES,
  ROLES,
  STAFF_ROLES,
  emailProblem,
  isUuid,
  maskEmail,
  nameProblem,
  normalizeEmail,
  onboardingRulesFor,
  parseOnboardingCommand,
} from '../../scripts/lib/onboarding.mjs';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const manifest = loadHostedManifest();
const staging = manifest.targets.staging;
const production = manifest.targets.production;
const productionRules = onboardingRulesFor({ kind: 'hosted', target: production });
const stagingRules = onboardingRulesFor({ kind: 'hosted', target: staging });
const entityId = 'aaaaaaaa-1111-4000-8000-000000000001';
const fakeSecret = 'sb_' + 'secret_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p';

// ---------------------------------------------------------------------------
// The rules each lane gives the tool
// ---------------------------------------------------------------------------

test('the five roles, four of them staff', () => {
  assert.deepEqual(ROLES, ['client_user', 'intake', 'preparer', 'reviewer', 'approver']);
  assert.deepEqual(STAFF_ROLES, ['intake', 'preparer', 'reviewer', 'approver']);
});

test('each hosted target names its environment and who may be staff', () => {
  assert.deepEqual(production.environment, { name: 'production', kind: 'production' });
  assert.equal(production.allowSyntheticAddresses, false);
  assert.deepEqual(production.staffEmailDomains, ['myhbcfo.com']);
  assert.equal(staging.allowSyntheticAddresses, true);
  assert.ok(staging.staffEmailDomains.includes('myhbcfo.com'));
  assert.deepEqual(productionRules.environment, production.environment);
  assert.deepEqual(onboardingRulesFor({ kind: 'loopback', target: null }), LOCAL_ONBOARDING_RULES);
  assert.equal(LOCAL_ONBOARDING_RULES.allowSyntheticAddresses, true);
});

// ---------------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------------

test('an address is lower-cased and trimmed, or it is not an address', () => {
  assert.equal(normalizeEmail('  Beth@MyHBCFO.com '), 'beth@myhbcfo.com');
  assert.equal(normalizeEmail('owner+books@client.example.org'), 'owner+books@client.example.org');
  for (const bad of [
    '',
    'beth',
    'beth@',
    '@myhbcfo.com',
    'a b@myhbcfo.com',
    'beth@localhost',
    null,
  ]) {
    assert.equal(normalizeEmail(bad), null, String(bad));
  }
});

test('on production a staff role goes only to a Honeybee address', () => {
  assert.equal(emailProblem('beth@myhbcfo.com', 'intake', productionRules), null);
  assert.match(emailProblem('beth@gmail.com', 'intake', productionRules), /staff/);
  assert.match(
    emailProblem('beth@myhbcfo.com.attacker.example', 'approver', productionRules),
    /.+/,
  );
  assert.match(emailProblem('beth@notmyhbcfo.com', 'preparer', productionRules), /staff/);
  assert.equal(emailProblem('owner@their-bakery.com', 'client_user', productionRules), null);
});

test('on production a reserved or test address is refused for everyone', () => {
  for (const address of [
    'someone@example.invalid',
    'someone@example.com',
    'someone@mail.test',
    'someone@sub.example',
  ]) {
    assert.match(emailProblem(address, 'client_user', productionRules), /reserved or test/);
  }
});

test('the rehearsal and local lanes admit synthetic addresses', () => {
  assert.equal(emailProblem('proof.client@example.invalid', 'client_user', stagingRules), null);
  assert.equal(emailProblem('proof.intake@example.invalid', 'intake', stagingRules), null);
  assert.equal(emailProblem('intake.beth@example.invalid', 'intake', LOCAL_ONBOARDING_RULES), null);
  assert.match(emailProblem('beth@gmail.com', 'intake', stagingRules), /staff/);
});

test('NEGATIVE: not an address, or not a role', () => {
  assert.match(emailProblem('beth', 'intake', productionRules), /not an email address/);
  assert.match(emailProblem('beth@myhbcfo.com', 'owner', productionRules), /role/);
  assert.match(emailProblem('beth@myhbcfo.com', undefined, productionRules), /role/);
});

test('an address is shown masked, never whole', () => {
  assert.equal(maskEmail('beth@myhbcfo.com'), 'b***@myhbcfo.com');
  assert.equal(maskEmail('a@client.example.org'), 'a***@client.example.org');
  assert.equal(maskEmail('not an address'), '(no address)');
  assert.equal(maskEmail(null), '(no address)');
});

// ---------------------------------------------------------------------------
// Names and ids
// ---------------------------------------------------------------------------

test('a name mirrors the server rule: two to 120 characters, one line', () => {
  assert.equal(nameProblem('Harbor Light Bakery LLC (Synthetic)'), null);
  assert.ok(nameProblem(''));
  assert.ok(nameProblem(' '));
  assert.ok(nameProblem('x'));
  assert.ok(nameProblem('x'.repeat(121)));
  assert.ok(nameProblem(`line one${String.fromCharCode(10)}line two`));
  assert.ok(nameProblem(undefined));
});

test('an id is a UUID and nothing else', () => {
  assert.equal(isUuid(entityId), true);
  assert.equal(isUuid(entityId.toUpperCase()), true);
  assert.equal(isUuid(`${entityId}'; drop table`), false);
  assert.equal(isUuid('entity-one'), false);
  assert.equal(isUuid(undefined), false);
});

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

test("onboard-entity takes a client name and an entity name and uses the lane's environment", () => {
  const parsed = parseOnboardingCommand(
    'onboard-entity',
    ['  Harbor  Light Bakery LLC (Synthetic) ', 'Harbor Light Holdings LLC (Synthetic)'],
    productionRules,
  );
  assert.deepEqual(parsed.problems, []);
  assert.deepEqual(parsed.values, {
    environmentName: 'production',
    environmentKind: 'production',
    clientName: '  Harbor  Light Bakery LLC (Synthetic) ',
    entityName: 'Harbor Light Holdings LLC (Synthetic)',
  });
  assert.ok(
    parseOnboardingCommand('onboard-entity', ['Only one'], productionRules).problems.length,
  );
  assert.ok(
    parseOnboardingCommand('onboard-entity', ['Client (Synthetic)', 'x'], productionRules).problems
      .length,
  );
  assert.ok(
    parseOnboardingCommand('onboard-entity', ['A', 'B', 'C'], productionRules).problems.length,
  );
});

test('invite and revoke-access take an address, a role, and an entity id', () => {
  for (const command of ['invite', 'revoke-access']) {
    const parsed = parseOnboardingCommand(
      command,
      [' Beth@MyHBCFO.com', 'intake', entityId],
      productionRules,
    );
    assert.deepEqual(parsed.problems, [], command);
    assert.deepEqual(parsed.values, { email: 'beth@myhbcfo.com', role: 'intake', entityId });
    assert.ok(
      parseOnboardingCommand(command, ['beth@myhbcfo.com', 'intake'], productionRules).problems
        .length,
    );
    assert.ok(
      parseOnboardingCommand(command, ['beth@myhbcfo.com', 'intake', 'not-an-id'], productionRules)
        .problems.length,
    );
    assert.ok(
      parseOnboardingCommand(command, ['beth@gmail.com', 'intake', entityId], productionRules)
        .problems.length,
    );
  }
});

test('the two reads take what they need and no more', () => {
  assert.deepEqual(parseOnboardingCommand('list-entities', [], productionRules).problems, []);
  assert.ok(parseOnboardingCommand('list-entities', ['extra'], productionRules).problems.length);
  assert.deepEqual(parseOnboardingCommand('list-access', [entityId], productionRules).values, {
    entityId,
  });
  assert.ok(parseOnboardingCommand('list-access', [], productionRules).problems.length);
  assert.ok(parseOnboardingCommand('list-access', ['nope'], productionRules).problems.length);
  assert.ok(parseOnboardingCommand('delete-everything', [], productionRules).problems.length);
});

test('on production the three changes need the project ref repeated and the two reads do not', () => {
  for (const command of ['onboard-entity', 'invite', 'revoke-access']) {
    assert.match(confirmationError('production', production, command, ''), /--confirm/);
    assert.equal(confirmationError('production', production, command, production.projectRef), null);
    assert.equal(confirmationError('staging', staging, command, ''), null);
  }
  for (const command of ['list-entities', 'list-access']) {
    assert.equal(confirmationError('production', production, command, ''), null);
  }
});

// ---------------------------------------------------------------------------
// The tools: every refusal happens before the network
// ---------------------------------------------------------------------------

const noNetwork = './tests/scripts/helpers/no-network.mjs';

function run(script, args, env) {
  const cleaned = Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => !name.startsWith('HIVE_HOSTED_') && !name.startsWith('HIVE_LOCAL_'),
    ),
  );
  return spawnSync(
    process.execPath,
    ['--import', noNetwork, path.join('scripts', script), ...args],
    {
      cwd: appRoot,
      encoding: 'utf8',
      env: { ...cleaned, ...env },
      timeout: 30_000,
    },
  );
}

test('CLI NEGATIVE: the runner refuses an onboarding change on production without the ref, and malformed arguments anywhere', () => {
  const unconfirmed = [
    ['production', 'onboard-entity', 'Client (Synthetic)', 'Entity (Synthetic)'],
    ['production', 'invite', 'beth@myhbcfo.com', 'intake', entityId],
    ['production', 'revoke-access', 'beth@myhbcfo.com', 'intake', entityId],
  ];
  for (const args of unconfirmed) {
    const refused = run('hosted-supabase.mjs', args, {});
    assert.equal(refused.status, 1, args.join(' '));
    assert.match(refused.stderr, /--confirm/);
  }
  const malformed = [
    ['staging', 'invite', 'beth', 'intake', entityId],
    ['staging', 'invite', 'beth@gmail.com', 'intake', entityId],
    ['staging', 'invite', 'proof@example.invalid', 'owner', entityId],
    ['staging', 'invite', 'proof@example.invalid', 'client_user', 'not-an-id'],
    ['staging', 'onboard-entity', 'Only one name'],
    ['staging', 'list-access'],
    [
      'production',
      'invite',
      'someone@example.invalid',
      'client_user',
      entityId,
      '--confirm',
      production.projectRef,
    ],
  ];
  for (const args of malformed) {
    const refused = run('hosted-supabase.mjs', args, {});
    assert.equal(refused.status, 1, args.join(' '));
    assert.ok(!/--confirm/.test(refused.stderr), args.join(' '));
  }
});

test('CLI NEGATIVE: the tool itself refuses the same things before the network', () => {
  const production_env = {
    HIVE_HOSTED_TARGET: 'production',
    HIVE_HOSTED_SUPABASE_URL: production.origin,
    HIVE_HOSTED_SECRET_KEY: fakeSecret,
  };
  const unconfirmed = run('onboarding.mjs', [], {
    ...production_env,
    HIVE_ONBOARD_COMMAND: 'invite',
    HIVE_ONBOARD_ARGS: JSON.stringify(['beth@myhbcfo.com', 'intake', entityId]),
  });
  assert.equal(unconfirmed.status, 1);
  assert.match(unconfirmed.stderr, /--confirm/);

  const outsider = run('onboarding.mjs', [], {
    ...production_env,
    HIVE_HOSTED_CONFIRM: production.projectRef,
    HIVE_ONBOARD_COMMAND: 'invite',
    HIVE_ONBOARD_ARGS: JSON.stringify(['beth@gmail.com', 'approver', entityId]),
  });
  assert.equal(outsider.status, 1);
  assert.match(outsider.stderr, /staff/);

  const wrongOrigin = run('onboarding.mjs', [], {
    HIVE_HOSTED_TARGET: 'staging',
    HIVE_HOSTED_SUPABASE_URL: production.origin,
    HIVE_HOSTED_SECRET_KEY: fakeSecret,
    HIVE_ONBOARD_COMMAND: 'list-entities',
    HIVE_ONBOARD_ARGS: '[]',
  });
  assert.equal(wrongOrigin.status, 1);
  assert.match(wrongOrigin.stderr, /approved origin/);

  const garbled = run('onboarding.mjs', [], {
    HIVE_HOSTED_TARGET: 'staging',
    HIVE_HOSTED_SUPABASE_URL: staging.origin,
    HIVE_HOSTED_SECRET_KEY: fakeSecret,
    HIVE_ONBOARD_COMMAND: 'invite',
    HIVE_ONBOARD_ARGS: 'not json',
  });
  assert.equal(garbled.status, 1);
  assert.match(garbled.stderr, /arguments/);
});
