#!/usr/bin/env node
/**
 * maestro:validate — structural validation of every Maestro flow before
 * any hardware run is scheduled (RETURN-3 area 8: parsed with a real
 * YAML parser — the pinned `yaml` dev dependency — so malformed YAML
 * fails instead of slipping past a line scanner).
 *
 * Checks per flow file:
 *  - the file parses as exactly two YAML documents (header, steps);
 *  - the header carries the exact development appId;
 *  - the steps document is a list where every step is a known Maestro
 *    command (bare string or single-key map);
 *  - every `id:` selector references a testID that exists in app/ or src/;
 *  - every runScript target exists in .maestro/;
 *  - banned patterns: any TOTP_SECRET channel, a secret in a URL query,
 *    and the nondeterministic constant '000000' as an input.
 * Helper .js files are checked for the URL-secret and TOTP_SECRET bans.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

import YAML from 'yaml';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const KNOWN_COMMANDS = new Set([
  'launchApp',
  'stopApp',
  'tapOn',
  'inputText',
  'eraseText',
  'assertVisible',
  'assertNotVisible',
  'copyTextFrom',
  'runScript',
  'openLink',
  'back',
  'setAirplaneMode',
  'extendedWaitUntil',
]);

const EXPECTED_APP_ID = 'com.myhbcfo.hive.development';

/** RETURN-4 P2-1: per-command PAYLOAD schemas. Knowing a command's name
 * is not validation — `tapOn: []` and a malformed `extendedWaitUntil`
 * both parse as YAML and both name a real command, and both fail on the
 * device. These schemas are matched to the pinned Maestro CLI recorded in
 * docs/plans (hardware toolchain record); the pin is what makes them
 * "version-matched" rather than guesswork. */
const SELECTOR_FIELDS = new Set([
  'id',
  'text',
  'index',
  'enabled',
  'checked',
  'focused',
  'selected',
  'optional',
  'label',
  'below',
  'above',
  'leftOf',
  'rightOf',
  'containsChild',
  'childOf',
  'containsDescendants',
  'width',
  'height',
  'tolerance',
  'point',
  'repeat',
  'delay',
  'longPress',
  'retryTapIfNoChange',
  'waitToSettleTimeoutMs',
]);

const SELECTOR_COMMANDS = new Set(['tapOn', 'assertVisible', 'assertNotVisible', 'copyTextFrom']);

const LAUNCH_FIELDS = new Set([
  'appId',
  'clearState',
  'clearKeychain',
  'stopApp',
  'permissions',
  'arguments',
]);

/** A selector is a non-empty string or a non-empty map of known selector
 * fields — never a list, never empty, never a bare number. */
function selectorProblems(where, payload, what = 'selector') {
  if (typeof payload === 'string') {
    return payload.trim() === '' ? [`${where}: ${what} is an empty string`] : [];
  }
  if (Array.isArray(payload)) {
    return [`${where}: ${what} must be a string or a map, not a list`];
  }
  if (typeof payload !== 'object' || payload === null) {
    return [`${where}: ${what} must be a string or a map (found ${typeof payload})`];
  }
  const keys = Object.keys(payload);
  if (keys.length === 0) return [`${where}: ${what} map is empty — it matches nothing`];
  const problems = [];
  for (const key of keys) {
    if (!SELECTOR_FIELDS.has(key)) {
      problems.push(`${where}: unknown ${what} field "${key}"`);
    }
  }
  if (typeof payload.id !== 'undefined' && typeof payload.id !== 'string') {
    problems.push(`${where}: ${what} id must be a string`);
  }
  if (typeof payload.text !== 'undefined' && typeof payload.text !== 'string') {
    problems.push(`${where}: ${what} text must be a string`);
  }
  if (typeof payload.index !== 'undefined' && !Number.isInteger(payload.index)) {
    problems.push(`${where}: ${what} index must be an integer`);
  }
  return problems;
}

function envMapProblems(where, env) {
  if (typeof env === 'undefined') return [];
  if (typeof env !== 'object' || env === null || Array.isArray(env)) {
    return [`${where}: env must be a map of string variables`];
  }
  const problems = [];
  for (const [key, value] of Object.entries(env)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      problems.push(`${where}: env variable name "${key}" is not a valid identifier`);
    }
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
      problems.push(`${where}: env variable "${key}" must be a scalar value`);
    }
  }
  return problems;
}

/** Validate one step's payload against its command's schema. */
export function validateStepPayload(command, payload, where, scriptFiles) {
  const problems = [];
  if (SELECTOR_COMMANDS.has(command)) {
    return selectorProblems(where, payload);
  }
  switch (command) {
    case 'launchApp': {
      if (payload === null || typeof payload === 'undefined') return [];
      if (typeof payload !== 'object' || Array.isArray(payload)) {
        problems.push(`${where}: launchApp payload must be a map`);
        break;
      }
      for (const key of Object.keys(payload)) {
        if (!LAUNCH_FIELDS.has(key)) problems.push(`${where}: unknown launchApp field "${key}"`);
      }
      for (const flag of ['clearState', 'clearKeychain', 'stopApp']) {
        if (typeof payload[flag] !== 'undefined' && typeof payload[flag] !== 'boolean') {
          problems.push(`${where}: launchApp ${flag} must be a boolean`);
        }
      }
      break;
    }
    case 'inputText': {
      if (typeof payload !== 'string') {
        problems.push(
          `${where}: inputText payload must be a string (a bare number is a YAML number and loses leading zeros)`,
        );
      } else if (payload === '') {
        problems.push(`${where}: inputText payload is empty`);
      }
      break;
    }
    case 'eraseText': {
      if (payload === null || typeof payload === 'undefined') return [];
      if (!Number.isInteger(payload) || payload < 1) {
        problems.push(`${where}: eraseText payload must be a positive integer character count`);
      }
      break;
    }
    case 'runScript': {
      if (typeof payload === 'object' && payload !== null && !Array.isArray(payload)) {
        for (const key of Object.keys(payload)) {
          if (key !== 'file' && key !== 'env') {
            problems.push(`${where}: unknown runScript field "${key}"`);
          }
        }
        problems.push(...envMapProblems(where, payload.env));
      }
      const target = typeof payload === 'string' ? payload : payload?.file;
      if (typeof target !== 'string' || target.trim() === '') {
        problems.push(`${where}: runScript needs a script file name`);
      } else if (!scriptFiles.has(target)) {
        problems.push(`${where}: runScript target "${target}" does not exist in .maestro/`);
      }
      break;
    }
    case 'openLink': {
      const link = typeof payload === 'string' ? payload : payload?.link;
      if (typeof link !== 'string' || link.trim() === '') {
        problems.push(`${where}: openLink needs a link string`);
      }
      break;
    }
    case 'stopApp':
    case 'back': {
      if (payload !== null && typeof payload !== 'undefined' && typeof payload !== 'string') {
        problems.push(`${where}: ${command} takes no payload (or an appId string)`);
      }
      break;
    }
    case 'setAirplaneMode': {
      if (payload !== 'enabled' && payload !== 'disabled') {
        problems.push(`${where}: setAirplaneMode must be exactly 'enabled' or 'disabled'`);
      }
      break;
    }
    case 'extendedWaitUntil': {
      if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
        problems.push(`${where}: extendedWaitUntil payload must be a map`);
        break;
      }
      const hasVisible = typeof payload.visible !== 'undefined';
      const hasNotVisible = typeof payload.notVisible !== 'undefined';
      if (hasVisible === hasNotVisible) {
        problems.push(`${where}: extendedWaitUntil requires exactly one of visible/notVisible`);
      }
      if (hasVisible)
        problems.push(...selectorProblems(where, payload.visible, 'visible selector'));
      if (hasNotVisible) {
        problems.push(...selectorProblems(where, payload.notVisible, 'notVisible selector'));
      }
      if (!Number.isInteger(payload.timeout) || payload.timeout <= 0) {
        problems.push(`${where}: extendedWaitUntil timeout must be a positive integer (ms)`);
      }
      for (const key of Object.keys(payload)) {
        if (!['visible', 'notVisible', 'timeout'].includes(key)) {
          problems.push(`${where}: unknown extendedWaitUntil field "${key}"`);
        }
      }
      break;
    }
    default:
      break;
  }
  return problems;
}

const HEADER_FIELDS = new Set(['appId', 'name', 'tags', 'env']);

/** Validate the flow header document (RETURN-4 P2-1). */
export function validateHeader(header, label) {
  const problems = [];
  if (typeof header !== 'object' || header === null || Array.isArray(header)) {
    return [`${label}: the header document must be a map`];
  }
  if (header.appId !== EXPECTED_APP_ID) {
    problems.push(`${label}: missing or wrong appId (expected ${EXPECTED_APP_ID})`);
  }
  for (const key of Object.keys(header)) {
    if (!HEADER_FIELDS.has(key)) problems.push(`${label}: unknown header field "${key}"`);
  }
  if (typeof header.name !== 'undefined' && typeof header.name !== 'string') {
    problems.push(`${label}: header name must be a string`);
  }
  if (typeof header.tags !== 'undefined') {
    if (!Array.isArray(header.tags) || header.tags.some((tag) => typeof tag !== 'string')) {
      problems.push(`${label}: header tags must be a list of strings`);
    }
  }
  problems.push(...envMapProblems(`${label} header`, header.env));
  return problems;
}

/** Collect every testID literal in the app sources. */
export function collectTestIds(root = appRoot) {
  const files = execFileSync('git', ['ls-files', 'app', 'src'], {
    cwd: root,
    encoding: 'utf8',
  })
    .split('\n')
    .filter((file) => /\.(tsx|ts)$/.test(file));
  const ids = new Set();
  for (const file of files) {
    const content = readFileSync(path.join(root, file), 'utf8');
    // Both the JSX attribute form (testID="x") and the object-property
    // form (testID: 'x') used by declarative nav/menu tables. A testID
    // declared in a table is still a testID; missing that form would make
    // the existence check silently weaker for exactly the screens that
    // list their destinations in one place.
    for (const match of content.matchAll(/testID\s*[=:]\s*["']([^"']+)["']/g)) {
      ids.add(match[1]);
    }
  }
  return ids;
}

function walkSelectors(node, visit) {
  if (Array.isArray(node)) {
    for (const item of node) walkSelectors(item, visit);
    return;
  }
  if (typeof node === 'object' && node !== null) {
    for (const [key, value] of Object.entries(node)) {
      visit(key, value);
      walkSelectors(value, visit);
    }
  }
}

/** Validate one flow file's text with a real YAML parse. */
export function validateFlowText(text, { fileName, knownTestIds, scriptFiles }) {
  const problems = [];
  const label = fileName;
  const documents = YAML.parseAllDocuments(text, { prettyErrors: true });
  for (const document of documents) {
    for (const error of document.errors) {
      problems.push(`${label}: YAML parse error — ${error.message.split('\n')[0]}`);
    }
  }
  if (problems.length > 0) return problems;
  if (documents.length !== 2) {
    problems.push(
      `${label}: expected exactly two YAML documents (header, steps); found ${documents.length}`,
    );
    return problems;
  }
  const header = documents[0].toJS();
  const steps = documents[1].toJS();
  problems.push(...validateHeader(header, label));
  if (!Array.isArray(steps)) {
    problems.push(`${label}: the steps document must be a list`);
    return problems;
  }
  for (const [index, step] of steps.entries()) {
    const where = `${label} step ${index + 1}`;
    let command;
    let payload;
    if (typeof step === 'string') {
      command = step;
    } else if (typeof step === 'object' && step !== null && Object.keys(step).length === 1) {
      [command] = Object.keys(step);
      payload = step[command];
    } else {
      problems.push(`${where}: a step must be a bare command or a single-command map`);
      continue;
    }
    if (!KNOWN_COMMANDS.has(command)) {
      problems.push(`${where}: unknown Maestro command "${command}"`);
      continue;
    }
    // Version-matched payload schema (RETURN-4 P2-1): naming a real
    // command is not enough — the payload must be one this Maestro
    // version can actually execute.
    problems.push(...validateStepPayload(command, payload, where, scriptFiles));
    if (command === 'inputText' && payload === '000000') {
      problems.push(
        `${where}: '000000' is a nondeterministic wrong code — derive the wrong code from the real one`,
      );
    }
    walkSelectors(payload, (key, value) => {
      if (key === 'id' && typeof value === 'string' && !knownTestIds.has(value)) {
        problems.push(`${where}: selector id "${value}" matches no testID in app/ or src/`);
      }
    });
  }
  if (/TOTP_SECRET/.test(text)) {
    problems.push(`${label}: TOTP_SECRET channel is banned — secrets stay in the helper's memory`);
  }
  if (/secret=/.test(text)) {
    problems.push(`${label}: a secret must never travel in a URL query`);
  }
  return problems;
}

/** Validate every flow and helper script under .maestro/. */
export function validateAllFlows(root = appRoot) {
  const maestroDir = path.join(root, '.maestro');
  const entries = readdirSync(maestroDir);
  const scriptFiles = new Set(entries.filter((entry) => entry.endsWith('.js')));
  const knownTestIds = collectTestIds(root);
  const problems = [];
  let flowCount = 0;
  for (const entry of entries) {
    if (entry.endsWith('.yaml')) {
      flowCount += 1;
      const text = readFileSync(path.join(maestroDir, entry), 'utf8');
      problems.push(...validateFlowText(text, { fileName: entry, knownTestIds, scriptFiles }));
    }
    if (entry.endsWith('.js')) {
      const text = readFileSync(path.join(maestroDir, entry), 'utf8');
      if (/TOTP_SECRET/.test(text)) {
        problems.push(`${entry}: TOTP_SECRET channel is banned`);
      }
      if (/[?&]secret=/.test(text)) {
        problems.push(`${entry}: a secret must never travel in a URL query`);
      }
    }
  }
  return { problems, flowCount, scriptCount: scriptFiles.size };
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  const { problems, flowCount, scriptCount } = validateAllFlows();
  console.log(
    `maestro:validate: ${flowCount} flows, ${scriptCount} helper scripts checked (real YAML parse)`,
  );
  if (problems.length > 0) {
    for (const problem of problems) console.error(`FAIL ${problem}`);
    console.error('maestro:validate FAILED');
    process.exit(1);
  }
  console.log('maestro:validate OK');
}
