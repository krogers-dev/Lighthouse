#!/usr/bin/env node
/**
 * ratification-record — drafts the approver's out-of-band decision record
 * for the history exceptions, and applies the matching provenance to the
 * allowlist entries once the approver has ratified in writing.
 *
 * This is TOOLING, not authority. The approval model (security/APPROVALS.md,
 * scripts/lib/ratification.mjs) stays exactly as it is:
 *
 *  - the record must live OUTSIDE the repository (this script refuses an
 *    --out path inside it), and is supplied at verification time through
 *    HIVE_APPROVAL_RECORDS with its digest stated independently through
 *    HIVE_APPROVAL_DIGESTS — channels the implementer does not control;
 *  - the record names the candidate commit whose allowlist substance it
 *    approves, so verification runs with HIVE_CANDIDATE_SHA set to that
 *    commit (the entry flip is itself a later commit, and a record cannot
 *    name the commit that carries its own digest);
 *  - `apply` is the implementer's mechanical step and is run only AFTER the
 *    approver's written ratification; it changes no substantive field, so
 *    the manifest digest the record binds is unchanged by it.
 *
 *   node scripts/ratification-record.mjs draft --out <file outside the repo>
 *       [--candidate <40-hex, default git HEAD>] [--approved-at <ISO, default now>]
 *       [--role <text>] [--destination <text>]
 *   node scripts/ratification-record.mjs apply --digest <sha256> --ratified-on <YYYY-MM-DD>
 *       [--reference <text>]
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { AUTHORIZED_APPROVERS, manifestSha256, sha256Hex } from './lib/ratification.mjs';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ALLOWLIST_PATH = path.join(appRoot, 'security', 'secret-scan-allowlist.json');
export const HISTORY_EXCEPTION_ACTION = 'history-exception-ratification';
export const APPROVER = 'Kody';
export const DEFAULT_ROLE = 'Owner of security and capability decisions (HIVE brief)';
export const DEFAULT_DESTINATION = 'HIVE local development lane, synthetic data only';

/** Path containment without string-prefix confusion (`/repo-evil` is not
 * inside `/repo`), mirroring the loader's rule. */
export function isInsideRepo(repoRoot, target) {
  const root = repoRoot.endsWith('/') ? repoRoot.slice(0, -1) : repoRoot;
  return target === root || target.startsWith(`${root}/`);
}

/** The decision record for one set of history exceptions. Every entry
 * must share the expiry the record states; the manifest digest covers the
 * whole effective allowlist exactly as `secrets:scan` computes it. Keys
 * are emitted in a fixed order so the same inputs always produce the same
 * bytes — the digest IS the binding. */
export function buildHistoryExceptionRecord({
  entries,
  candidate,
  approvedAt,
  role = DEFAULT_ROLE,
  destination = DEFAULT_DESTINATION,
}) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return { problem: 'the allowlist holds no entries to ratify' };
  }
  const expiries = [...new Set(entries.map((entry) => entry.expiry ?? entry.expires))];
  if (expiries.length !== 1 || typeof expiries[0] !== 'string') {
    return {
      problem: `one record binds one expiry, but the entries carry ${expiries.length}: ${expiries.join(', ')}`,
    };
  }
  if (!/^[0-9a-f]{40}$/.test(candidate ?? '')) {
    return { problem: `candidate must be a 40-hex commit sha, got ${JSON.stringify(candidate)}` };
  }
  if (Number.isNaN(Date.parse(approvedAt ?? ''))) {
    return { problem: `approvedAt must be an ISO timestamp, got ${JSON.stringify(approvedAt)}` };
  }
  const record = {
    approver: APPROVER,
    role,
    action: HISTORY_EXCEPTION_ACTION,
    manifestSha256: manifestSha256(entries),
    candidate,
    destination,
    approvedAt,
    expires: expiries[0],
    entries: entries.map((entry) => ({
      blob: entry.blob,
      path: entry.path,
      pattern: entry.pattern,
      expectedCount: entry.expectedCount,
    })),
    statement: `I, ${APPROVER}, ratify the ${entries.length} proposed history exception(s) listed here for candidate ${candidate}.`,
  };
  const bytes = Buffer.from(`${JSON.stringify(record, null, 2)}\n`, 'utf8');
  return { record, bytes, digest: sha256Hex(bytes) };
}

/** Flip every proposed entry to ratified with the provenance the verifier
 * demands. Substantive fields are untouched (the manifest digest is
 * unchanged); already-ratified entries are left alone. */
export function applyRatification(entries, { digest, ratifiedOn, reference }) {
  if (!/^[0-9a-f]{64}$/.test(digest ?? '')) {
    return { problem: 'digest must be the sha256 of the decision record' };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ratifiedOn ?? '')) {
    return { problem: 'ratifiedOn must be YYYY-MM-DD and match the record approvedAt date' };
  }
  let flipped = 0;
  const next = entries.map((entry) => {
    if (entry.approvalStatus !== 'proposed') return entry;
    flipped += 1;
    return {
      ...entry,
      approvalStatus: 'ratified',
      ratifiedOn,
      ratifiedBy: APPROVER,
      approvalReference:
        reference ??
        `Ratified in writing by ${APPROVER} on ${ratifiedOn}; decision record held out-of-band, sha256 ${digest}`,
      decisionRecordDigest: digest,
    };
  });
  return { entries: next, flipped };
}

/** The exact verification invocation, in both shells the project uses. */
export function verificationCommands({ candidate, recordPath, digest }) {
  return {
    bash: `HIVE_CANDIDATE_SHA=${candidate} HIVE_APPROVAL_RECORDS=${recordPath} HIVE_APPROVAL_DIGESTS=${digest} npm run secrets:scan`,
    powershell: `$env:HIVE_CANDIDATE_SHA='${candidate}'; $env:HIVE_APPROVAL_RECORDS='${recordPath}'; $env:HIVE_APPROVAL_DIGESTS='${digest}'; npm run secrets:scan`,
  };
}

function readAllowlist() {
  return JSON.parse(readFileSync(ALLOWLIST_PATH, 'utf8'));
}

function arg(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] !== undefined ? process.argv[index + 1] : fallback;
}

function fail(message) {
  console.error(`ratification-record: ${message}`);
  process.exit(1);
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  const command = process.argv[2];
  if (command === 'draft') {
    const out = arg('--out');
    if (!out)
      fail(
        'usage: draft --out <file outside the repo> [--candidate] [--approved-at] [--role] [--destination]',
      );
    const outAbs = path.resolve(out);
    const outDir = path.dirname(outAbs);
    if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
    if (isInsideRepo(realpathSync(appRoot), realpathSync(outDir))) {
      fail(
        `--out ${outAbs} is inside the repository — approval material must live outside the candidate it approves`,
      );
    }
    if (!AUTHORIZED_APPROVERS.has(APPROVER)) fail(`${APPROVER} is not an authorized approver`);
    const candidate =
      arg('--candidate') ??
      execFileSync('git', ['rev-parse', 'HEAD'], { cwd: appRoot, encoding: 'utf8' }).trim();
    const built = buildHistoryExceptionRecord({
      entries: readAllowlist().entries,
      candidate,
      approvedAt: arg('--approved-at', new Date().toISOString()),
      role: arg('--role', DEFAULT_ROLE),
      destination: arg('--destination', DEFAULT_DESTINATION),
    });
    if (built.problem) fail(built.problem);
    writeFileSync(outAbs, built.bytes);
    const commands = verificationCommands({ candidate, recordPath: outAbs, digest: built.digest });
    console.log(`ratification-record: drafted ${outAbs} (outside the repository)`);
    console.log(`  sha256: ${built.digest}`);
    console.log(`  candidate: ${candidate}`);
    console.log(
      `  entries bound: ${built.record.entries.length}; manifest ${built.record.manifestSha256}`,
    );
    console.log(
      'This file is a DRAFT until the approver has ratified in writing and keeps it themselves.',
    );
    console.log('Then apply the provenance and commit:');
    console.log(
      `  node scripts/ratification-record.mjs apply --digest ${built.digest} --ratified-on ${built.record.approvedAt.slice(0, 10)}`,
    );
    console.log('And verify at the candidate, record supplied out-of-band:');
    console.log(`  bash:       ${commands.bash}`);
    console.log(`  powershell: ${commands.powershell}`);
  } else if (command === 'apply') {
    const digest = arg('--digest');
    const ratifiedOn = arg('--ratified-on');
    const allowlist = readAllowlist();
    const applied = applyRatification(allowlist.entries, {
      digest,
      ratifiedOn,
      reference: arg('--reference'),
    });
    if (applied.problem) fail(applied.problem);
    writeFileSync(
      ALLOWLIST_PATH,
      `${JSON.stringify({ ...allowlist, entries: applied.entries }, null, 2)}\n`,
    );
    console.log(
      `ratification-record: ${applied.flipped} entr${applied.flipped === 1 ? 'y' : 'ies'} marked ratified (${ratifiedOn}, digest ${digest.slice(0, 12)}…) — commit this, then verify with the record supplied out-of-band`,
    );
  } else {
    fail(
      'usage: ratification-record.mjs <draft --out <file> | apply --digest <sha256> --ratified-on <date>>',
    );
  }
}
