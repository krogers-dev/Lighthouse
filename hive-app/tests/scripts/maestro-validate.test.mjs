import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import YAML from 'yaml';

import {
  FORBIDDEN_COMMANDS,
  KNOWN_COMMANDS,
  collectTestIds,
  collectTestIdsFromText,
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

test('collectTestIds reads the three forms a real testID is written in', () => {
  const ids = collectTestIds();
  // 1. A JSX attribute, testID="x".
  assert.ok(ids.has('dashboard-refresh'));
  // 2. An object property, testID: 'x' (the nav item tables).
  assert.ok(ids.has('nav-account'));
  // 3. A `const <NAME>_TEST_IDS = { ... } as const;` table. These exist
  //    BECAUSE the collector cannot see a template literal: a shared
  //    component that built `${prefix}-offline` at runtime would let a
  //    device flow reference an id no screen renders and still validate.
  //    Each state id below is reachable only through that table.
  for (const id of [
    'requests-stale',
    'activity-offline',
    'request-detail-denied',
    'dashboard-expired',
  ]) {
    assert.ok(ids.has(id), `${id} should be collected from a testID table`);
  }
});

test('a prop ending in TestID declares a testID (find 37: TextField labelTestID)', () => {
  const ids = collectTestIdsFromText(
    '<TextField testID="zzz-field" labelTestID="zzz-field-label" />\n' +
      "const row = { labelTestID: 'zzz-row-label' };\n" +
      // Not a testID declaration: a lowercase suffix or a different word.
      '<View testId="zzz-not-a-testid" dataTestID2="zzz-not-either" />\n',
  );
  assert.deepEqual([...ids].sort(), ['zzz-field', 'zzz-field-label', 'zzz-row-label']);
});

test('the testID-table form is parsed, not merely present in some other form', () => {
  // A table whose ids appear nowhere else in the sources: if the table
  // parser regressed, none of these would be found. Proves the parser
  // itself, independent of what the app happens to render today.
  const ids = collectTestIdsFromText(
    'const SAMPLE_TEST_IDS = {\n' +
      "  alpha: { loading: 'zzz-alpha-loading', error: 'zzz-alpha-error' },\n" +
      "  beta: { loading: 'zzz-beta-loading' },\n" +
      '} as const;\n',
  );
  assert.deepEqual([...ids].sort(), ['zzz-alpha-error', 'zzz-alpha-loading', 'zzz-beta-loading']);
});

test('EVERY real flow in .maestro/ validates cleanly', () => {
  const { problems, flowCount, scriptCount } = validateAllFlows();
  assert.deepEqual(problems, []);
  // 10 Milestone 0 critical-path flows, the RETURN-4 P1-8 pair (the
  // forced-failure confinement probe and the cleanup-only clipboard
  // scrub), the two Milestone 1 read-surface flows (requests,
  // activity-and-help), the two Milestone 1 read-surface state flows
  // (offline replaces content; revoked membership leaves no stale
  // rows), the nav-persistence flow (the five destinations are peers, so
  // the nav survives arriving at each one), and staff-sign-out, which the
  // enrollment runner uses instead of sign-out because the two identities
  // resume differently: client.owner is re-asked which workspace,
  // reviewer.rae goes straight to Home (find 34).
  //
  // Exact, not a floor: an accidental extra flow should be noticed.
  assert.equal(flowCount, 18);
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

// Find 13: Maestro matches a text selector as a REGEX, so an unescaped
// "(Synthetic)" is a capture group and the selector asks for text no screen
// renders. In `tapOn` that fails loudly. In `assertNotVisible` it can never
// fail — the two cross-entity leak assertions in scope-switch.yaml were
// passing vacuously for exactly this reason. The strings below are the real
// pre-fix selector text, not invented fixtures.
test('an UNESCAPED parenthesis in a text selector is rejected', () => {
  const base = `appId: com.myhbcfo.hive.development\nname: fixture\n---\n`;
  const problems = validateFlowText(
    `${base}- tapOn: 'Harbor Light Bakery LLC (Synthetic).*'\n`,
    context,
  );
  assert.ok(
    problems.some((p) => p.includes('unescaped')),
    `expected an unescaped-parenthesis problem, got ${JSON.stringify(problems)}`,
  );
});

test('the vacuous assertNotVisible that could never fail is rejected', () => {
  const base = `appId: com.myhbcfo.hive.development\nname: fixture\n---\n`;
  const problems = validateFlowText(
    `${base}- assertNotVisible: '2025 books close (Synthetic)'\n`,
    context,
  );
  assert.ok(
    problems.some((p) => p.includes('unescaped')),
    `expected an unescaped-parenthesis problem, got ${JSON.stringify(problems)}`,
  );
});

test('the map form of a text selector is checked too', () => {
  const base = `appId: com.myhbcfo.hive.development\nname: fixture\n---\n`;
  const problems = validateFlowText(
    `${base}- assertVisible:\n    text: 'Bank statement (Synthetic)'\n`,
    context,
  );
  assert.ok(problems.some((p) => p.includes('unescaped')));
});

test('ESCAPED parentheses and deliberate regex groups are accepted', () => {
  const base = `appId: com.myhbcfo.hive.development\nname: fixture\n---\n`;
  // The corrected selectors from sign-in.yaml and scope-switch.yaml, plus a
  // genuine alternation group, which is a legitimate regex and must pass.
  assert.deepEqual(
    validateFlowText(
      `${base}- tapOn: 'Harbor Light Bakery LLC \\(Synthetic\\), Harbor Light Bakery LLC \\(Synthetic\\), Client access'\n` +
        `- assertNotVisible: '2025 books close \\(Synthetic\\)'\n` +
        `- assertVisible: 'Needs attention|Waiting on records'\n`,
      context,
    ),
    [],
  );
});

// Find 17: Help's content version sits below the fold, so `assertVisible`
// alone could never see it — the flows had no scroll vocabulary at all.
const scrollBase = `appId: com.myhbcfo.hive.development\nname: fixture\n---\n`;

test('scrollUntilVisible with an element selector validates', () => {
  assert.deepEqual(
    validateFlowText(
      `${scrollBase}- scrollUntilVisible:\n    element:\n      id: 'mfa-code'\n`,
      context,
    ),
    [],
  );
});

test('scrollUntilVisible without an element is rejected', () => {
  const problems = validateFlowText(`${scrollBase}- scrollUntilVisible: 'down'\n`, context);
  assert.ok(
    problems.some((p) => p.includes('element')),
    `expected an element requirement, got ${JSON.stringify(problems)}`,
  );
});

test('a testID nested under scrollUntilVisible is still cross-checked', () => {
  const problems = validateFlowText(
    `${scrollBase}- scrollUntilVisible:\n    element:\n      id: 'no-such-test-id'\n`,
    context,
  );
  assert.ok(problems.some((p) => p.includes('matches no testID')));
});

test('an unknown scrollUntilVisible field is rejected', () => {
  const problems = validateFlowText(
    `${scrollBase}- scrollUntilVisible:\n    element:\n      id: 'mfa-code'\n    sideways: true\n`,
    context,
  );
  assert.ok(problems.some((p) => p.includes('sideways')));
});

// Find 37: hideKeyboard entered the vocabulary for find 30 and left again —
// on Android it is an unconditional BACK key press, and with no soft
// keyboard showing it exits the single-entry auth stack. The validator
// refuses it WITH the reason, so nobody re-adds it as "known".
test('NEGATIVE: hideKeyboard is forbidden with the reason, and is not merely unknown', () => {
  const base = `appId: com.myhbcfo.hive.development\nname: fixture\n---\n`;
  const problems = validateFlowText(`${base}- hideKeyboard\n`, context);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /forbidden/);
  assert.match(problems[0], /BACK/);
  assert.match(problems[0], /find 37/);
  assert.ok(!problems[0].includes('unknown Maestro command'));
  assert.ok(!KNOWN_COMMANDS.has('hideKeyboard'));
  assert.ok(FORBIDDEN_COMMANDS.has('hideKeyboard'));
});

test('finds 37 and 47: the MFA flows bring the verify control into view before every verify tap, never by hideKeyboard or a label tap', () => {
  for (const flow of ['mfa-enroll.yaml', 'mfa-login.yaml']) {
    const text = readFileSync(new URL(`../../.maestro/${flow}`, import.meta.url), 'utf8');
    const [, stepsDoc] = YAML.parseAllDocuments(text);
    const steps = stepsDoc.toJS();
    const name = (step) => (typeof step === 'string' ? step : Object.keys(step)[0]);
    assert.ok(!steps.some((s) => name(s) === 'hideKeyboard'), `${flow} still uses hideKeyboard`);
    assert.ok(
      !steps.some((s) => name(s) === 'tapOn' && s.tapOn?.id === 'mfa-code-label'),
      `${flow} still blurs the field by its label (find 47)`,
    );
    const submits = steps
      .map((s, i) => [s, i])
      .filter(([s]) => name(s) === 'tapOn' && s.tapOn?.id === 'mfa-submit');
    assert.ok(submits.length > 0, `${flow} taps mfa-submit`);
    for (const [, i] of submits) {
      const before = steps[i - 1];
      assert.equal(
        name(before),
        'scrollUntilVisible',
        `${flow}: the step before tapping mfa-submit (step ${i + 1}) must scroll it into view`,
      );
      assert.equal(before.scrollUntilVisible?.element?.id, 'mfa-submit');
      assert.equal(before.scrollUntilVisible?.direction, 'DOWN');
    }
  }
});
