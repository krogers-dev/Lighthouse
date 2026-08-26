import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  collectTestIds,
  validateAllFlows,
  validateFlowText,
} from '../../scripts/maestro-validate.mjs';

const context = {
  fileName: 'fixture.yaml',
  knownTestIds: new Set(['sign-in-email', 'mfa-code']),
  scriptFiles: new Set(['totp-code.js']),
};

const VALID_FLOW = `appId: com.myhbcfo.hive.development
name: fixture
---
- launchApp
- tapOn:
    id: 'sign-in-email'
- inputText: 'client.owner@example.invalid'
- runScript: totp-code.js
- assertVisible: 'Home'
`;

test('a well-formed flow validates cleanly', () => {
  assert.deepEqual(validateFlowText(VALID_FLOW, context), []);
});

test('MALFORMED YAML is rejected by the real parser', () => {
  const bad = `appId: com.myhbcfo.hive.development\n---\n- tapOn:\n   id: 'x'\n  broken indentation: [unclosed\n`;
  const problems = validateFlowText(bad, context);
  assert.ok(
    problems.some((p) => p.includes('YAML parse error')),
    JSON.stringify(problems),
  );
});

test('wrong appId, wrong document count, and unknown commands are flagged', () => {
  const wrongApp = `appId: com.other.app\n---\n- launchApp\n`;
  assert.ok(validateFlowText(wrongApp, context).some((p) => p.includes('appId')));
  const oneDoc = `appId: com.myhbcfo.hive.development\n`;
  assert.ok(
    validateFlowText(oneDoc, context).some((p) => p.includes('exactly two YAML documents')),
  );
  const unknown = `appId: com.myhbcfo.hive.development\n---\n- swipeUpMagic\n`;
  assert.ok(validateFlowText(unknown, context).some((p) => p.includes('swipeUpMagic')));
});

test('multi-key step maps are rejected (silent step fusion)', () => {
  const fused = `appId: com.myhbcfo.hive.development\n---\n- tapOn: 'Email'\n  inputText: 'x'\n`;
  const problems = validateFlowText(fused, context);
  assert.ok(
    problems.some((p) => p.includes('single-command map') || p.includes('YAML parse error')),
    JSON.stringify(problems),
  );
});

test('unknown testIDs and missing runScript targets are flagged', () => {
  const bad = `appId: com.myhbcfo.hive.development\n---\n- tapOn:\n    id: 'no-such-id'\n- runScript: missing.js\n`;
  const problems = validateFlowText(bad, context);
  assert.ok(problems.some((p) => p.includes('no-such-id')));
  assert.ok(problems.some((p) => p.includes('missing.js')));
});

test('banned patterns are flagged: TOTP_SECRET, URL secrets, constant 000000', () => {
  const bad = `appId: com.myhbcfo.hive.development\n---\n- inputText: '000000'\n# uses \${TOTP_SECRET} and http://x/code?secret=abc\n`;
  const problems = validateFlowText(bad, context);
  assert.ok(problems.some((p) => p.includes('000000')));
  assert.ok(problems.some((p) => p.includes('TOTP_SECRET')));
  assert.ok(problems.some((p) => p.includes('URL query')));
});

test('collectTestIds finds real testIDs from the app sources', () => {
  const ids = collectTestIds();
  assert.ok(ids.has('sign-in-email'));
  assert.ok(ids.has('mfa-enroll-qr'));
  assert.ok(ids.has('dashboard-workspace'));
});

test('EVERY real flow in .maestro/ validates cleanly', () => {
  const { problems, flowCount, scriptCount } = validateAllFlows();
  assert.deepEqual(problems, []);
  // 10 Milestone 0 critical-path flows, the RETURN-4 P1-8 pair (the
  // forced-failure confinement probe and the cleanup-only clipboard
  // scrub), and the two Milestone 1 read-surface flows.
  assert.equal(flowCount, 14);
  assert.ok(scriptCount >= 4);
});

// ---- RETURN-4 P2-1: version-matched per-command PAYLOAD schemas ----
// Every fixture below names a REAL Maestro command and parses as valid
// YAML; only a payload schema rejects them. Each one fails on a device.

test('NEGATIVE: an empty tapOn payload is rejected (it names a real command and parses)', () => {
  const emptyList = `appId: com.myhbcfo.hive.development\n---\n- tapOn: []\n`;
  const problems = validateFlowText(emptyList, context);
  assert.ok(
    problems.some((p) => p.includes('must be a string or a map, not a list')),
    JSON.stringify(problems),
  );
  const emptyMap = `appId: com.myhbcfo.hive.development\n---\n- tapOn: {}\n`;
  assert.ok(validateFlowText(emptyMap, context).some((p) => p.includes('matches nothing')));
  const emptyString = `appId: com.myhbcfo.hive.development\n---\n- tapOn: ''\n`;
  assert.ok(validateFlowText(emptyString, context).some((p) => p.includes('empty string')));
});

test('NEGATIVE: unknown selector fields and wrong selector field types are rejected', () => {
  const typo = `appId: com.myhbcfo.hive.development\n---\n- tapOn:\n    testID: 'mfa-code'\n`;
  assert.ok(validateFlowText(typo, context).some((p) => p.includes('unknown selector field')));
  const numericId = `appId: com.myhbcfo.hive.development\n---\n- assertVisible:\n    id: 12345\n`;
  assert.ok(validateFlowText(numericId, context).some((p) => p.includes('id must be a string')));
});

test('NEGATIVE: a numeric inputText payload is rejected (YAML numbers lose leading zeros)', () => {
  const numeric = `appId: com.myhbcfo.hive.development\n---\n- inputText: 012345\n`;
  const problems = validateFlowText(numeric, context);
  assert.ok(
    problems.some((p) => p.includes('inputText payload must be a string')),
    JSON.stringify(problems),
  );
  const empty = `appId: com.myhbcfo.hive.development\n---\n- inputText: ''\n`;
  assert.ok(validateFlowText(empty, context).some((p) => p.includes('inputText payload is empty')));
});

test('NEGATIVE: malformed extendedWaitUntil payloads are rejected', () => {
  const base = 'appId: com.myhbcfo.hive.development\n---\n';
  // Neither visible nor notVisible.
  assert.ok(
    validateFlowText(`${base}- extendedWaitUntil:\n    timeout: 5000\n`, context).some((p) =>
      p.includes('exactly one of visible/notVisible'),
    ),
  );
  // Both.
  assert.ok(
    validateFlowText(
      `${base}- extendedWaitUntil:\n    visible: 'Home'\n    notVisible: 'Home'\n    timeout: 5000\n`,
      context,
    ).some((p) => p.includes('exactly one of visible/notVisible')),
  );
  // Missing / non-integer / non-positive timeout.
  assert.ok(
    validateFlowText(`${base}- extendedWaitUntil:\n    visible: 'Home'\n`, context).some((p) =>
      p.includes('timeout must be a positive integer'),
    ),
  );
  assert.ok(
    validateFlowText(
      `${base}- extendedWaitUntil:\n    visible: 'Home'\n    timeout: '5000'\n`,
      context,
    ).some((p) => p.includes('timeout must be a positive integer')),
  );
  assert.ok(
    validateFlowText(
      `${base}- extendedWaitUntil:\n    visible: 'Home'\n    timeout: 0\n`,
      context,
    ).some((p) => p.includes('timeout must be a positive integer')),
  );
  // Unknown field.
  assert.ok(
    validateFlowText(
      `${base}- extendedWaitUntil:\n    visible: 'Home'\n    timeout: 5000\n    forever: true\n`,
      context,
    ).some((p) => p.includes('unknown extendedWaitUntil field')),
  );
  // A well-formed one passes.
  assert.deepEqual(
    validateFlowText(
      `${base}- extendedWaitUntil:\n    visible:\n      id: 'mfa-code'\n    timeout: 10000\n`,
      context,
    ),
    [],
  );
});

test('NEGATIVE: header fields and flow variables are type-checked', () => {
  const unknownField = `appId: com.myhbcfo.hive.development\nappID: typo\n---\n- back\n`;
  assert.ok(
    validateFlowText(unknownField, context).some((p) => p.includes('unknown header field')),
  );
  const badName = `appId: com.myhbcfo.hive.development\nname: 12345\n---\n- back\n`;
  assert.ok(validateFlowText(badName, context).some((p) => p.includes('name must be a string')));
  const badTags = `appId: com.myhbcfo.hive.development\ntags: 'smoke'\n---\n- back\n`;
  assert.ok(validateFlowText(badTags, context).some((p) => p.includes('tags must be a list')));
  const badEnv = `appId: com.myhbcfo.hive.development\nenv:\n  '1BAD': 'x'\n---\n- back\n`;
  assert.ok(validateFlowText(badEnv, context).some((p) => p.includes('not a valid identifier')));
  const listEnv = `appId: com.myhbcfo.hive.development\nenv:\n  - QA_USER\n---\n- back\n`;
  assert.ok(validateFlowText(listEnv, context).some((p) => p.includes('env must be a map')));
  const okHeader = `appId: com.myhbcfo.hive.development\nname: fixture\ntags:\n  - mfa\nenv:\n  QA_USER: 'reviewer.rae@example.invalid'\n---\n- back\n`;
  assert.deepEqual(validateFlowText(okHeader, context), []);
});

test('NEGATIVE: helper (runScript) payload shapes are checked', () => {
  const base = 'appId: com.myhbcfo.hive.development\n---\n';
  assert.ok(
    validateFlowText(`${base}- runScript: 42\n`, context).some((p) =>
      p.includes('needs a script file name'),
    ),
  );
  assert.ok(
    validateFlowText(`${base}- runScript:\n    file: 'missing.js'\n`, context).some((p) =>
      p.includes('does not exist in .maestro/'),
    ),
  );
  assert.ok(
    validateFlowText(`${base}- runScript:\n    script: 'totp-code.js'\n`, context).some((p) =>
      p.includes('unknown runScript field'),
    ),
  );
  assert.ok(
    validateFlowText(
      `${base}- runScript:\n    file: 'totp-code.js'\n    env:\n      TOTP_USER:\n        nested: true\n`,
      context,
    ).some((p) => p.includes('must be a scalar value')),
  );
  assert.deepEqual(
    validateFlowText(
      `${base}- runScript:\n    file: 'totp-code.js'\n    env:\n      TOTP_USER: 'reviewer.rae@example.invalid'\n`,
      context,
    ),
    [],
  );
});

test('NEGATIVE: launchApp, eraseText, setAirplaneMode payloads are checked', () => {
  const base = 'appId: com.myhbcfo.hive.development\n---\n';
  assert.ok(
    validateFlowText(`${base}- launchApp:\n    clearstate: true\n`, context).some((p) =>
      p.includes('unknown launchApp field'),
    ),
  );
  assert.ok(
    validateFlowText(`${base}- launchApp:\n    clearState: 'yes'\n`, context).some((p) =>
      p.includes('clearState must be a boolean'),
    ),
  );
  assert.ok(
    validateFlowText(`${base}- eraseText: 'all'\n`, context).some((p) =>
      p.includes('positive integer character count'),
    ),
  );
  assert.ok(
    validateFlowText(`${base}- setAirplaneMode: true\n`, context).some((p) =>
      p.includes("exactly 'enabled' or 'disabled'"),
    ),
  );
  assert.deepEqual(
    validateFlowText(
      `${base}- launchApp:\n    clearState: true\n- eraseText: 6\n- setAirplaneMode: enabled\n`,
      context,
    ),
    [],
  );
});
