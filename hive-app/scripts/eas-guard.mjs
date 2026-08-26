#!/usr/bin/env node
/**
 * eas:guard — keeps the EAS lane to the one thing it was authorized for.
 *
 * The simulator lane exists to answer a single open question: does this
 * app compile for iOS? Signing, submission, and release are HOLD under
 * CLAUDE.md, and an eas.json is exactly the file where that boundary
 * erodes quietly — one added `production` profile, one `submit` block,
 * one `"simulator": false`, and the repository is configured for a lane
 * nobody approved. Configuration drift like that does not announce
 * itself in a diff review months later, so it is asserted here instead.
 *
 * What this refuses:
 *  - any build profile that is not the authorized simulator profile;
 *  - an iOS profile that is not `simulator: true` (that is a device
 *    build, which needs Apple Developer credentials and signing);
 *  - any `submit` configuration at all;
 *  - credential, certificate, provisioning, or Apple-account keys;
 *  - an .easignore that has drifted from .gitignore, which is how
 *    .env.local would start being uploaded.
 *
 * Exit codes follow the repository contract: 0 pass, 1 findings,
 * 2 engine failure.
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The single profile this repository is authorized to build. Changing
 * this name is a deliberate act and shows up in the diff as one. */
export const AUTHORIZED_PROFILE = 'ios-simulator';

/** Keys that only ever appear when a build is being signed, submitted,
 * or attached to an Apple account. None of these are authorized. */
const FORBIDDEN_KEYS = [
  'submit',
  'credentialsSource',
  'distribution',
  'appleId',
  'appleTeamId',
  'ascAppId',
  'ascApiKeyPath',
  'provisioningProfilePath',
  'distributionCertificate',
  'autoIncrement',
];

/** Inspect a parsed eas.json. Pure, so the refusals are testable without
 * writing config files to disk. */
export function auditEasConfig(config) {
  const problems = [];
  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    return ['eas.json does not parse as an object'];
  }

  if ('submit' in config) {
    problems.push(
      'eas.json declares a `submit` configuration — submission is HOLD and no submit lane is authorized',
    );
  }

  const build = config.build;
  if (build === undefined) return [...problems, 'eas.json declares no build profiles'];
  if (build === null || typeof build !== 'object' || Array.isArray(build)) {
    return [...problems, 'eas.json `build` is not an object'];
  }

  const names = Object.keys(build);
  for (const name of names) {
    if (name !== AUTHORIZED_PROFILE) {
      problems.push(
        `build profile '${name}' is not authorized — only '${AUTHORIZED_PROFILE}' is, and it builds for the simulator only`,
      );
    }
  }
  if (!names.includes(AUTHORIZED_PROFILE)) {
    problems.push(`the authorized profile '${AUTHORIZED_PROFILE}' is missing from eas.json`);
  }

  for (const [name, profile] of Object.entries(build)) {
    if (profile === null || typeof profile !== 'object' || Array.isArray(profile)) {
      problems.push(`build profile '${name}' is not an object`);
      continue;
    }
    // A device build is the thing this guard exists to catch: it is what
    // requires signing, and `simulator` merely being absent is enough to
    // produce one. Absence is treated as a device build, not as a default.
    const ios = profile.ios;
    if (ios === undefined) {
      problems.push(
        `build profile '${name}' declares no ios block, so it does not pin simulator-only building`,
      );
    } else if (ios === null || typeof ios !== 'object' || Array.isArray(ios)) {
      problems.push(`build profile '${name}' has a malformed ios block`);
    } else if (ios.simulator !== true) {
      problems.push(
        `build profile '${name}' is not simulator-only (ios.simulator is ${JSON.stringify(ios.simulator)}) — a device build needs Apple Developer credentials and signing, which are HOLD`,
      );
    }

    for (const key of FORBIDDEN_KEYS) {
      if (key in profile) {
        problems.push(
          `build profile '${name}' sets '${key}', which belongs to a signed or submitted lane`,
        );
      }
      if (ios && typeof ios === 'object' && !Array.isArray(ios) && key in ios) {
        problems.push(
          `build profile '${name}' sets ios.${key}, which belongs to a signed or submitted lane`,
        );
      }
    }

    if ('android' in profile) {
      problems.push(
        `build profile '${name}' configures android — the EAS lane is authorized for the iOS compile question only; Android builds locally`,
      );
    }
  }

  return problems;
}

/** Every meaningful line of an ignore file, comments and blanks dropped. */
export function ignoreEntries(text) {
  if (typeof text !== 'string') return [];
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));
}

/** .easignore must cover everything .gitignore does.
 *
 * The failure this prevents is specific and silent: if .easignore
 * replaces .gitignore when deciding what to upload, then a .gitignore
 * entry with no counterpart here means that file starts being sent to a
 * third party. `.env*.local` is the one that matters. */
export function missingFromEasignore(gitignoreText, easignoreText) {
  const eas = new Set(ignoreEntries(easignoreText));
  return ignoreEntries(gitignoreText).filter((entry) => !eas.has(entry));
}

function main() {
  const easPath = path.join(appRoot, 'eas.json');
  if (!existsSync(easPath)) {
    // Not a finding: no EAS lane configured is a perfectly good state,
    // and was this repository's state until the lane was authorized.
    console.log('eas:guard: no eas.json — no EAS lane is configured');
    process.exit(0);
  }

  let config;
  try {
    config = JSON.parse(readFileSync(easPath, 'utf8'));
  } catch (error) {
    console.error(`eas:guard ENGINE FAILURE: eas.json is not valid JSON — ${error.message}`);
    process.exit(2);
  }

  const problems = auditEasConfig(config);

  const easignorePath = path.join(appRoot, '.easignore');
  if (!existsSync(easignorePath)) {
    problems.push(
      '.easignore is missing — the upload set would fall back to .gitignore implicitly rather than being stated',
    );
  } else {
    const missing = missingFromEasignore(
      readFileSync(path.join(appRoot, '.gitignore'), 'utf8'),
      readFileSync(easignorePath, 'utf8'),
    );
    for (const entry of missing) {
      problems.push(
        `.easignore does not cover .gitignore entry '${entry}' — that file would be uploaded to the build service`,
      );
    }
  }

  if (problems.length > 0) {
    for (const problem of problems) console.error(`FAIL ${problem}`);
    console.error(`eas:guard FAILED — ${problems.length} problem(s)`);
    process.exit(1);
  }

  console.log(
    `eas:guard OK — one profile ('${AUTHORIZED_PROFILE}'), simulator-only, no submit lane, upload set covers .gitignore`,
  );
  process.exit(0);
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) main();
