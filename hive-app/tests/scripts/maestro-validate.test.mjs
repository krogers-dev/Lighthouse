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

test('wrong appId, missing separator, and unknown commands are flagged', () => {
  const bad = `appId: com.other.app\n- launchApp\n- swipeUpMagic: {}\n`;
  const problems = validateFlowText(bad, context);
  assert.ok(problems.some((p) => p.includes('appId')));
  assert.ok(problems.some((p) => p.includes('separator')));
  assert.ok(problems.some((p) => p.includes('swipeUpMagic')));
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
  assert.equal(flowCount, 10);
  assert.ok(scriptCount >= 2);
});
