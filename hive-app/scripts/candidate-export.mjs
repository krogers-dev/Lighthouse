#!/usr/bin/env node
/**
 * export:candidate — the ATOMIC authorized synthetic candidate lane
 * (RETURN-4 P1-3).
 *
 * One command that, in order:
 *   1. resolves the approved configuration (fail-closed: missing or
 *      unapproved configuration stops the lane before any export);
 *   2. creates a FRESH private output directory (mkdtemp, mode 0700) —
 *      preplanted, stale, or hand-edited dist/ contents can never be what
 *      gets inspected, because inspection only ever sees this new
 *      directory;
 *   3. runs the pinned `expo export --platform all` into it with the QA
 *      hooks variable DELETED from the child environment (recorded);
 *   4. verifies THAT output: metadata.json, the iOS and Android Hermes
 *      bundles it names, at least one web JS bundle — each meeting a
 *      minimum payload size — without hardcoding file counts;
 *   5. runs bundle-inspect --profile candidate over THAT directory;
 *   6. records the command, tool versions, source commit, config-manifest
 *      digest, and a full output manifest (path, size, sha256 per file).
 *
 * `--qa-control` preserves the QA-enabled positive control: the same lane
 * with EXPO_PUBLIC_QA_HOOKS=1, expected to make inspection FAIL on the
 * qa-hook marker — proving the detector sees a real export.
 *
 * LABEL: this is the authorized synthetic candidate lane. It builds an
 * expressly synthetic, nonfunctional configuration (loopback origin,
 * synthetic publishable-shaped key). It is NEVER a functional build and
 * is never reported as one.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { collectFiles, loadApproved } from './bundle-inspect.mjs';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** A real Hermes/web bundle for this app is far larger; anything under
 * this floor is not a bundled application payload. */
export const PAYLOAD_FLOOR_BYTES = 4096;

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

/** Verify the freshly exported directory: presence and minimum payload of
 * every platform, driven by the export's own metadata — no hardcoded
 * counts. Returns human-readable problems. */
export function verifyExportOutput(outDir, readFileAt, statAt) {
  const problems = [];
  let metadata;
  try {
    metadata = JSON.parse(readFileAt(path.join(outDir, 'metadata.json')).toString('utf8'));
  } catch {
    return ['metadata.json is missing or unreadable — the export did not produce its manifest'];
  }
  for (const platform of ['ios', 'android']) {
    const bundle = metadata?.fileMetadata?.[platform]?.bundle;
    if (typeof bundle !== 'string' || bundle === '') {
      problems.push(`metadata.json names no ${platform} bundle — platform output missing`);
      continue;
    }
    let size;
    try {
      size = statAt(path.join(outDir, bundle)).size;
    } catch {
      problems.push(`${platform} bundle ${bundle} named by metadata.json does not exist`);
      continue;
    }
    if (size < PAYLOAD_FLOOR_BYTES) {
      problems.push(
        `${platform} bundle ${bundle} is ${size} bytes — below the ${PAYLOAD_FLOOR_BYTES}-byte payload floor (not a real application payload)`,
      );
    }
  }
  let webBundles = [];
  try {
    webBundles = collectFiles(path.join(outDir, '_expo', 'static', 'js', 'web')).filter((f) =>
      f.endsWith('.js'),
    );
  } catch {
    // handled below as absence
  }
  if (webBundles.length === 0) {
    problems.push('no web JS bundle under _expo/static/js/web — web platform output missing');
  } else if (!webBundles.some((f) => statAt(f).size >= PAYLOAD_FLOOR_BYTES)) {
    problems.push('every web JS bundle is below the payload floor — not a real web payload');
  }
  try {
    statAt(path.join(outDir, 'index.html'));
  } catch {
    problems.push('index.html is missing from the web output');
  }
  return problems;
}

function toolVersions() {
  const expoPkg = JSON.parse(
    readFileSync(path.join(appRoot, 'node_modules', 'expo', 'package.json'), 'utf8'),
  );
  let npmVersion = 'unknown';
  try {
    npmVersion = execFileSync('npm', ['--version'], { encoding: 'utf8' }).trim();
  } catch {
    // recorded as unknown; node + expo pins still identify the toolchain
  }
  return { node: process.version, npm: npmVersion, expo: expoPkg.version };
}

function sourceCommit() {
  try {
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: appRoot,
      encoding: 'utf8',
    }).trim();
    const dirty =
      execFileSync('git', ['status', '--porcelain'], { cwd: appRoot, encoding: 'utf8' }).trim() !==
      '';
    return { sha, dirty };
  } catch {
    return { sha: 'unknown', dirty: true };
  }
}

function configManifestDigest() {
  const files = ['app.json', 'metro.config.js', 'package.json', 'security/approved-config.json'];
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(file);
    hash.update('\0');
    hash.update(readFileSync(path.join(appRoot, file)));
    hash.update('\0');
  }
  return { files, sha256: hash.digest('hex') };
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  const qaControl = process.argv.includes('--qa-control');
  const recordFlag = process.argv.indexOf('--record');
  const recordPath =
    recordFlag !== -1
      ? path.resolve(process.argv[recordFlag + 1])
      : path.join(
          appRoot,
          'security',
          'evidence',
          qaControl ? 'candidate-export-qa-control.json' : 'candidate-export.json',
        );

  // 1. Approved configuration first: nothing is exported on a bad config.
  const approved = loadApproved('candidate');
  if ((approved.problems ?? []).length > 0) {
    for (const problem of approved.problems) console.error(`FAIL ${problem}`);
    console.error('export:candidate FAILED (approved configuration) — nothing was exported');
    process.exit(1);
  }

  // 2. Fresh private output directory: mkdtemp creates it empty, 0700.
  const outDir = mkdtempSync(path.join(tmpdir(), 'hive-candidate-'));

  // 3. Pinned export with QA hooks REMOVED from the environment.
  const childEnv = { ...process.env };
  delete childEnv.EXPO_PUBLIC_QA_HOOKS;
  if (qaControl) childEnv.EXPO_PUBLIC_QA_HOOKS = '1';
  const command = [
    'npx',
    '--no-install',
    'expo',
    'export',
    '--platform',
    'all',
    '--output-dir',
    outDir,
  ];
  console.log(
    `export:candidate: ${qaControl ? 'QA-ENABLED POSITIVE CONTROL' : 'authorized synthetic candidate lane'} — exporting into fresh 0700 directory ${outDir}`,
  );
  console.log(
    `export:candidate: qaHooks ${qaControl ? 'ENABLED (positive control)' : 'disabled (EXPO_PUBLIC_QA_HOOKS deleted from the child environment)'}; effective profile: candidate`,
  );
  const exported = spawnSync(command[0], command.slice(1), {
    cwd: appRoot,
    env: childEnv,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  });
  if (exported.error || exported.status !== 0) {
    console.error(exported.stdout ?? '');
    console.error(exported.stderr ?? String(exported.error ?? ''));
    console.error(
      `export:candidate FAILED — expo export exited ${exported.status ?? 'without running'}`,
    );
    process.exit(1);
  }

  // 4. Verify THAT output.
  const outputProblems = verifyExportOutput(
    outDir,
    (p) => readFileSync(p),
    (p) => statSync(p),
  );
  if (outputProblems.length > 0) {
    for (const problem of outputProblems) console.error(`FAIL ${problem}`);
    console.error('export:candidate FAILED (platform output verification)');
    process.exit(1);
  }

  // 5. Inspect THAT directory — the inspector's exit code is decisive.
  const inspect = spawnSync(
    process.execPath,
    [path.join(appRoot, 'scripts', 'bundle-inspect.mjs'), '--profile', 'candidate'],
    {
      cwd: appRoot,
      env: { ...childEnv, HIVE_BUNDLE_DIST: outDir },
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  process.stdout.write(inspect.stdout ?? '');
  process.stderr.write(inspect.stderr ?? '');

  // 6. Record the run.
  const files = collectFiles(outDir).sort();
  const manifest = files.map((file) => {
    const buffer = readFileSync(file);
    return {
      path: path.relative(outDir, file),
      bytes: buffer.length,
      sha256: sha256(buffer),
    };
  });
  const record = {
    lane: qaControl
      ? 'QA-enabled positive control (expected to FAIL inspection)'
      : 'authorized synthetic candidate lane — expressly synthetic nonfunctional configuration; NOT a functional build',
    command: command.join(' '),
    outputDir: outDir,
    qaHooks: qaControl ? 'enabled (positive control)' : 'disabled',
    profile: 'candidate',
    toolVersions: toolVersions(),
    sourceCommit: sourceCommit(),
    configManifest: configManifestDigest(),
    approvedOrigin: approved.url,
    inspectExit: inspect.status,
    fileCount: manifest.length,
    outputManifest: manifest,
    recordedAt: new Date().toISOString(),
  };
  writeFileSync(recordPath, JSON.stringify(record, null, 2) + '\n');
  console.log(`export:candidate: run record written to ${path.relative(appRoot, recordPath)}`);

  if (qaControl) {
    if (inspect.status === 1 && /qa-hook-marker/.test(inspect.stderr ?? '')) {
      console.log(
        'export:candidate QA CONTROL OK — the QA-enabled export was correctly REJECTED by inspection (the detector sees real exports)',
      );
      process.exit(0);
    }
    console.error(
      `export:candidate QA CONTROL FAILED — inspection exited ${inspect.status} without flagging the qa-hook marker`,
    );
    process.exit(1);
  }
  if (inspect.status !== 0) {
    console.error(`export:candidate FAILED — inspection exited ${inspect.status}`);
    process.exit(inspect.status === 3 ? 3 : 1);
  }
  console.log(
    'export:candidate OK — authorized synthetic candidate lane passed (synthetic nonfunctional configuration; NOT a functional build)',
  );
}
