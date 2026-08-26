/** eas:guard — the refusals that keep the EAS lane to its authorization.
 *
 * Every case below is a plausible edit rather than an invented one: the
 * profile someone copies from a tutorial, the `submit` block the CLI
 * offers to add, the `simulator` flag that quietly goes missing. Each
 * would turn a compile check into a signing or submission lane, which is
 * HOLD, and none of them look alarming in a diff.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  AUTHORIZED_PROFILE,
  auditEasConfig,
  ignoreEntries,
  missingFromEasignore,
} from '../../scripts/eas-guard.mjs';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const AUTHORIZED = {
  cli: { appVersionSource: 'local' },
  build: { 'ios-simulator': { ios: { simulator: true }, env: {} } },
};

test('the config actually committed to this repository passes', () => {
  const config = JSON.parse(readFileSync(path.join(appRoot, 'eas.json'), 'utf8'));
  assert.deepEqual(auditEasConfig(config), []);
});

test('the authorized shape passes', () => {
  assert.deepEqual(auditEasConfig(AUTHORIZED), []);
});

test('NEGATIVE: a device build is refused — that is the one that needs signing', () => {
  const device = { build: { 'ios-simulator': { ios: { simulator: false } } } };
  assert.ok(
    auditEasConfig(device).some((p) => p.includes('not simulator-only')),
    JSON.stringify(auditEasConfig(device)),
  );
});

test('NEGATIVE: simulator merely ABSENT is refused, not defaulted', () => {
  // The trap: omitting the flag produces a device build. Treating absence
  // as "probably fine" is exactly how the boundary would erode.
  const noFlag = { build: { 'ios-simulator': { ios: {} } } };
  assert.ok(auditEasConfig(noFlag).some((p) => p.includes('not simulator-only')));
  const noIos = { build: { 'ios-simulator': { env: {} } } };
  assert.ok(auditEasConfig(noIos).some((p) => p.includes('declares no ios block')));
});

test('NEGATIVE: any additional build profile is refused', () => {
  const extra = {
    build: {
      'ios-simulator': { ios: { simulator: true } },
      production: { ios: { simulator: true } },
    },
  };
  const problems = auditEasConfig(extra);
  assert.ok(problems.some((p) => p.includes("build profile 'production' is not authorized")));
  // ...even when the extra profile is itself simulator-only: the point is
  // that one named lane was authorized, not that any safe lane may exist.
  assert.equal(problems.length, 1);
});

test('NEGATIVE: a submit configuration is refused outright', () => {
  const submit = { ...AUTHORIZED, submit: { production: { ios: { appleId: 'x' } } } };
  assert.ok(auditEasConfig(submit).some((p) => p.includes('submission is HOLD')));
});

test('NEGATIVE: signing and Apple-account keys are refused wherever they sit', () => {
  for (const key of [
    'credentialsSource',
    'distribution',
    'appleId',
    'appleTeamId',
    'ascAppId',
    'provisioningProfilePath',
    'distributionCertificate',
    'autoIncrement',
  ]) {
    const onProfile = {
      build: { 'ios-simulator': { ios: { simulator: true }, [key]: 'anything' } },
    };
    assert.ok(
      auditEasConfig(onProfile).some((p) => p.includes(`sets '${key}'`)),
      `profile-level ${key}`,
    );
    const onIos = {
      build: { 'ios-simulator': { ios: { simulator: true, [key]: 'anything' } } },
    };
    assert.ok(
      auditEasConfig(onIos).some((p) => p.includes(`sets ios.${key}`)),
      `ios-level ${key}`,
    );
  }
});

test('NEGATIVE: an android block is refused — Android builds locally, not here', () => {
  const android = {
    build: { 'ios-simulator': { ios: { simulator: true }, android: { buildType: 'apk' } } },
  };
  assert.ok(auditEasConfig(android).some((p) => p.includes('configures android')));
});

test('NEGATIVE: a malformed or empty config is refused, never passed through', () => {
  for (const input of [null, [], 'string', 42]) {
    assert.ok(auditEasConfig(input).length > 0, `input: ${JSON.stringify(input)}`);
  }
  assert.ok(auditEasConfig({}).some((p) => p.includes('no build profiles')));
  assert.ok(auditEasConfig({ build: [] }).some((p) => p.includes('`build` is not an object')));
  assert.ok(
    auditEasConfig({ build: {} }).some((p) => p.includes(`'${AUTHORIZED_PROFILE}' is missing`)),
  );
});

// ---- the upload set ----

test('ignoreEntries drops comments and blank lines, keeps patterns', () => {
  assert.deepEqual(ignoreEntries('# a comment\n\n  node_modules/  \n*.pem\n'), [
    'node_modules/',
    '*.pem',
  ]);
  assert.deepEqual(ignoreEntries(null), []);
});

test('the committed .easignore covers every .gitignore entry', () => {
  const missing = missingFromEasignore(
    readFileSync(path.join(appRoot, '.gitignore'), 'utf8'),
    readFileSync(path.join(appRoot, '.easignore'), 'utf8'),
  );
  assert.deepEqual(missing, []);
});

test('NEGATIVE: a .easignore that drops an entry is caught, env files above all', () => {
  // This is the failure that would send .env.local to a third party, and
  // it happens by writing a .easignore that lists only ADDITIONS.
  const gitignore = 'node_modules/\n.env*.local\ndist/\n';
  const additionsOnly = '# just the extras\ndocs/\n';
  assert.deepEqual(missingFromEasignore(gitignore, additionsOnly), [
    'node_modules/',
    '.env*.local',
    'dist/',
  ]);
  const complete = 'node_modules/\n.env*.local\ndist/\ndocs/\n';
  assert.deepEqual(missingFromEasignore(gitignore, complete), []);
});
