#!/usr/bin/env node
/**
 * maestro:validate — structural validation of every Maestro flow before
 * any hardware run is scheduled (second RETURN directive, area 7).
 *
 * Deliberately line-oriented (no YAML dependency): flows here are flat
 * step lists. Checks, per flow file:
 *  - the exact development appId and the `---` document separator;
 *  - every top-level step uses a known Maestro command;
 *  - every `id:` selector references a testID that exists in app/ or src/;
 *  - every runScript target exists in .maestro/;
 *  - banned patterns: any TOTP_SECRET channel, a secret in a URL query,
 *    and the nondeterministic constant '000000' as an input.
 * Helper .js files are checked for the URL-secret ban too.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

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

/** Validate one flow file's text. Returns human-readable problems. */
export function validateFlowText(text, { fileName, knownTestIds, scriptFiles }) {
  const problems = [];
  const label = fileName;
  if (!new RegExp(`^appId:\\s*${EXPECTED_APP_ID}\\s*$`, 'm').test(text)) {
    problems.push(`${label}: missing or wrong appId (expected ${EXPECTED_APP_ID})`);
  }
  if (!/^---$/m.test(text)) {
    problems.push(`${label}: missing the --- document separator`);
  }
  for (const line of text.split('\n')) {
    const step = /^- ([A-Za-z]+)\s*:?/.exec(line);
    if (step && !KNOWN_COMMANDS.has(step[1])) {
      problems.push(`${label}: unknown Maestro command "${step[1]}"`);
    }
    const id = /^\s+id:\s*['"]([^'"]+)['"]\s*$/.exec(line);
    if (id && !knownTestIds.has(id[1])) {
      problems.push(`${label}: selector id "${id[1]}" matches no testID in app/ or src/`);
    }
    const script = /^- runScript:\s*(\S+)\s*$/.exec(line);
    if (script && !scriptFiles.has(script[1])) {
      problems.push(`${label}: runScript target "${script[1]}" does not exist in .maestro/`);
    }
    if (/inputText:\s*['"]?000000['"]?\s*$/.test(line)) {
      problems.push(
        `${label}: '000000' is a nondeterministic wrong code — derive the wrong code from the real one`,
      );
    }
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
  console.log(`maestro:validate: ${flowCount} flows, ${scriptCount} helper scripts checked`);
  if (problems.length > 0) {
    for (const problem of problems) console.error(`FAIL ${problem}`);
    console.error('maestro:validate FAILED');
    process.exit(1);
  }
  console.log('maestro:validate OK');
}
