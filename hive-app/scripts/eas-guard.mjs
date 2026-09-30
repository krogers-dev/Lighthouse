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
 *  - a .easignore that is not at the git root, or that has drifted from
 *    either .gitignore, which is how .env.local and the generated native
 *    projects start being uploaded (find 52, 2026-09-07: EAS CLI reads
 *    .easignore at the git root ONLY, and the nested one this repository
 *    used to carry was never read — the first build uploaded 342 MB
 *    against 9 MB of tracked content).
 *
 * Exit codes follow the repository contract: 0 pass, 1 findings,
 * 2 engine failure.
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** The git root: the only place EAS CLI reads .easignore from. */
const repoRoot = path.resolve(appRoot, '..');
/** hive-app/ as EAS sees it from the git root, forward slashes. */
export const APP_PREFIX = 'hive-app/';

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

/** A .gitignore entry as it must be spelled in a .easignore that lives at
 * the git root, when the .gitignore lives in `prefix` below it.
 *
 * gitignore semantics: an entry with a slash anywhere but the end is
 * anchored to its own file's directory, so from the root it needs that
 * directory in front (`/ios` → `hive-app/ios`, `supabase/.temp/` →
 * `hive-app/supabase/.temp/`); an entry with no slash, or only a trailing
 * one, matches at any depth and is spelled the same everywhere
 * (`node_modules/`, `*.pem`, `.env*.local`). A negation keeps its `!`. */
export function rootedEntry(entry, prefix) {
  const negated = entry.startsWith('!');
  const pattern = negated ? entry.slice(1) : entry;
  const body = pattern.endsWith('/') ? pattern.slice(0, -1) : pattern;
  let rooted;
  if (pattern.startsWith('/')) rooted = `${prefix}${pattern.slice(1)}`;
  else if (body.includes('/')) rooted = `${prefix}${pattern}`;
  else rooted = pattern;
  return negated ? `!${rooted}` : rooted;
}

/** The root .easignore must cover everything each .gitignore does.
 *
 * The failure this prevents is specific and silent: the root .easignore
 * REPLACES every .gitignore when EAS decides what to upload, so a
 * .gitignore entry with no counterpart there means that file starts being
 * sent to a third party. `.env*.local` and the generated native projects
 * are the ones that matter. */
export function missingFromEasignore(gitignoreText, easignoreText, prefix = '') {
  const eas = new Set(ignoreEntries(easignoreText));
  return ignoreEntries(gitignoreText)
    .map((entry) => rootedEntry(entry, prefix))
    .filter((entry) => !eas.has(entry));
}

/** Where the .easignore lives decides whether EAS reads it at all. */
export function easignoreLayoutProblems({ rootExists, nestedExists }) {
  const problems = [];
  if (!rootExists) {
    problems.push(
      '.easignore is missing from the git root — EAS CLI reads it there only, so the upload set would fall back to the working tree filtered by .gitignore, which its Windows copy applies incompletely (find 52)',
    );
  }
  if (nestedExists) {
    problems.push(
      'hive-app/.easignore exists — EAS CLI never reads a nested .easignore; the root one is the upload set, so remove the nested file rather than let two disagree',
    );
  }
  return problems;
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

  const easignorePath = path.join(repoRoot, '.easignore');
  problems.push(
    ...easignoreLayoutProblems({
      rootExists: existsSync(easignorePath),
      nestedExists: existsSync(path.join(appRoot, '.easignore')),
    }),
  );
  if (existsSync(easignorePath)) {
    const easignoreText = readFileSync(easignorePath, 'utf8');
    const sources = [
      { label: '.gitignore', file: path.join(repoRoot, '.gitignore'), prefix: '' },
      { label: 'hive-app/.gitignore', file: path.join(appRoot, '.gitignore'), prefix: APP_PREFIX },
    ];
    for (const source of sources) {
      const missing = missingFromEasignore(
        readFileSync(source.file, 'utf8'),
        easignoreText,
        source.prefix,
      );
      for (const entry of missing) {
        problems.push(
          `the root .easignore does not cover ${source.label} entry '${entry}' — that file would be uploaded to the build service`,
        );
      }
    }
    // The shallow clone's .git is uploaded unless the .easignore names it
    // (the CLI special-cases exactly this check).
    if (!ignoreEntries(easignoreText).includes('.git')) {
      problems.push(
        "the root .easignore does not list '.git' — the clone's repository metadata would be uploaded",
      );
    }
  }

  if (problems.length > 0) {
    for (const problem of problems) console.error(`FAIL ${problem}`);
    console.error(`eas:guard FAILED — ${problems.length} problem(s)`);
    process.exit(1);
  }

  console.log(
    `eas:guard OK — one profile ('${AUTHORIZED_PROFILE}'), simulator-only, no submit lane, root .easignore covers both .gitignore files`,
  );
  process.exit(0);
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) main();
