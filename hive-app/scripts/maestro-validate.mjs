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
    for (const match of content.matchAll(/testID=["']([^"']+)["']/g)) {
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
  if (typeof header !== 'object' || header === null || header.appId !== EXPECTED_APP_ID) {
    problems.push(`${label}: missing or wrong appId (expected ${EXPECTED_APP_ID})`);
  }
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
    if (command === 'runScript') {
      const target = typeof payload === 'string' ? payload : payload?.file;
      if (typeof target !== 'string' || !scriptFiles.has(target)) {
        problems.push(`${where}: runScript target "${target}" does not exist in .maestro/`);
      }
    }
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
