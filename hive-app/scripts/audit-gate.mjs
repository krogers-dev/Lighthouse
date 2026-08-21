#!/usr/bin/env node
/**
 * audit:gate — npm audit with recorded waivers, fail-closed
 * (P1 item 6; hardened by the second RETURN directive, area 6).
 *
 * `npm audit --audit-level=high` has no ignore mechanism, so this gate
 * runs the audit itself and fails on any high/critical advisory not
 * covered by an unexpired, well-formed waiver in security/waivers.json.
 *
 * Fail-closed contract:
 *  - npm bootstrap/spawn failures (including ENOENT), signal termination,
 *    unexpected exit codes, empty output, and malformed JSON are engine
 *    failures (exit 2);
 *  - malformed reports (per-vulnerability schema, metadata summary counts
 *    that do not reconcile with the vulnerability nodes) are engine
 *    failures too — output that fails its own schema cannot be trusted;
 *  - malformed / duplicate / expired / orphaned waivers, waivers whose
 *    recorded package or severity does not match the LIVE report,
 *    unwaived high/critical advisories, and prohibited assets are
 *    failures (exit 1);
 *  - waivers whose approvalStatus is 'proposed' (not yet ratified by
 *    Kody in writing) match findings but produce HOLD (exit 3) — a
 *    pending approval is never treated as approval and no output ever
 *    claims an advisory was "waived by" anyone before ratification.
 *
 * The compensating asset control derives from the advisories actually
 * matched in the live report (their report-side package names), never
 * from editable waiver labels, and detects ICNS/JXL/HEIF payloads by
 * file signature as well as extension.
 *
 * Integration-tested against a fake npm executable
 * (tests/scripts/audit-gate-integration.test.mjs).
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { openSync, readSync, closeSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const GHSA_PATTERN = /^GHSA(-[a-z0-9]{4}){3}$/;
const SEVERITIES = ['info', 'low', 'moderate', 'high', 'critical'];
const SEVERITY_SET = new Set(SEVERITIES);

/** True only for a real ISO calendar date (rejects 2026-02-30, month 13,
 * and every non-`YYYY-MM-DD` shape). */
export function isRealIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/** Validate the shape npm audit --json is contractually expected to emit,
 * including every vulnerability node's schema and the reconciliation of
 * metadata.vulnerabilities against the detailed nodes. Returns problems;
 * empty means the report is usable. */
export function validateAuditReport(report) {
  const problems = [];
  if (typeof report !== 'object' || report === null || Array.isArray(report)) {
    return ['audit output is not a JSON object'];
  }
  if ('error' in report) {
    problems.push(
      `npm reported a top-level error (${report.error?.code ?? 'unknown code'}) instead of an audit report`,
    );
    return problems;
  }
  if (report.auditReportVersion !== 2) {
    problems.push(`unsupported or missing auditReportVersion (${report.auditReportVersion})`);
  }
  if (typeof report.vulnerabilities !== 'object' || report.vulnerabilities === null) {
    problems.push('report has no vulnerabilities object');
    return problems;
  }
  if (
    typeof report.metadata !== 'object' ||
    report.metadata === null ||
    typeof report.metadata.vulnerabilities !== 'object' ||
    report.metadata.vulnerabilities === null
  ) {
    problems.push('report has no metadata.vulnerabilities summary');
    return problems;
  }
  // Per-node schema: every affected-package node must be well-formed.
  const nodeCounts = Object.fromEntries(SEVERITIES.map((s) => [s, 0]));
  for (const [key, node] of Object.entries(report.vulnerabilities)) {
    const label = `vulnerability node "${key}"`;
    if (typeof node !== 'object' || node === null || Array.isArray(node)) {
      problems.push(`${label}: not an object`);
      continue;
    }
    if (node.name !== key) {
      problems.push(`${label}: name "${node.name}" does not match its key`);
    }
    if (!SEVERITY_SET.has(node.severity)) {
      problems.push(`${label}: invalid severity "${node.severity}"`);
      continue;
    }
    nodeCounts[node.severity] += 1;
    if (!Array.isArray(node.via) || node.via.length === 0) {
      problems.push(`${label}: via must be a non-empty array`);
      continue;
    }
    for (const via of node.via) {
      if (typeof via === 'string') continue; // transitive reference
      if (typeof via !== 'object' || via === null) {
        problems.push(`${label}: via entry is neither a string nor an object`);
        continue;
      }
      if (typeof via.name !== 'string' || via.name.length === 0) {
        problems.push(`${label}: advisory via entry has no package name`);
      }
      if (!SEVERITY_SET.has(via.severity)) {
        problems.push(`${label}: advisory via entry has invalid severity "${via.severity}"`);
      }
      if (typeof via.url !== 'string' || !via.url.includes('/advisories/')) {
        problems.push(`${label}: advisory via entry has no advisory url`);
      }
    }
  }
  // Summary reconciliation: metadata counts affected package NODES per
  // severity (npm's contract); they must equal what the nodes say.
  const summary = report.metadata.vulnerabilities;
  let total = 0;
  for (const severity of SEVERITIES) {
    const reported = summary[severity];
    if (!Number.isInteger(reported) || reported < 0) {
      problems.push(`metadata.vulnerabilities.${severity} is not a non-negative integer`);
      continue;
    }
    total += reported;
    if (reported !== nodeCounts[severity]) {
      problems.push(
        `metadata.vulnerabilities.${severity} (${reported}) does not reconcile with the ${nodeCounts[severity]} detailed ${severity} node(s)`,
      );
    }
  }
  if (Number.isInteger(summary.total) && summary.total !== total) {
    problems.push(
      `metadata.vulnerabilities.total (${summary.total}) does not equal the per-severity sum (${total})`,
    );
  }
  return problems;
}

/** Validate waiver entries themselves. Returns problems; empty means ok.
 * approvalStatus: 'proposed' entries are schema-valid but produce HOLD in
 * evaluateAudit; only 'ratified' (with ratifiedOn) counts as approval. */
export function validateWaivers(waiverFile, today) {
  const problems = [];
  const waivers = waiverFile?.waivers;
  if (!Array.isArray(waivers)) {
    return ['waiver file has no waivers array'];
  }
  const seen = new Set();
  waivers.forEach((waiver, index) => {
    const label = `waiver[${index}] (${waiver?.advisory ?? 'no advisory'})`;
    if (typeof waiver !== 'object' || waiver === null) {
      problems.push(`${label}: not an object`);
      return;
    }
    if (!GHSA_PATTERN.test(waiver.advisory ?? '')) problems.push(`${label}: malformed advisory id`);
    if (typeof waiver.package !== 'string' || waiver.package.length === 0)
      problems.push(`${label}: missing package`);
    if (!SEVERITY_SET.has(waiver.severity)) problems.push(`${label}: invalid severity`);
    if (typeof waiver.owner !== 'string' || waiver.owner.length === 0)
      problems.push(`${label}: missing owner`);
    if (typeof waiver.reason !== 'string' || waiver.reason.length < 10)
      problems.push(`${label}: missing or trivial reason`);
    if (typeof waiver.retest !== 'string' || waiver.retest.trim().length === 0)
      problems.push(`${label}: retest procedure is required and must not be blank`);
    if (waiver.approvalStatus !== 'proposed' && waiver.approvalStatus !== 'ratified') {
      problems.push(
        `${label}: approvalStatus must be exactly 'proposed' or 'ratified' (free-text approval strings are not an approval state)`,
      );
    }
    if (!isRealIsoDate(waiver.proposedOn ?? ''))
      problems.push(`${label}: proposedOn must be a real calendar date`);
    if (waiver.approvalStatus === 'ratified') {
      if (!isRealIsoDate(waiver.ratifiedOn ?? '')) {
        problems.push(`${label}: ratified entries require a real ratifiedOn date`);
      } else if (isRealIsoDate(waiver.proposedOn ?? '') && waiver.ratifiedOn < waiver.proposedOn) {
        problems.push(`${label}: ratifiedOn cannot precede proposedOn`);
      }
    }
    if (!isRealIsoDate(waiver.expires ?? '')) {
      problems.push(`${label}: expires must be a real calendar date`);
    } else {
      if (isRealIsoDate(waiver.proposedOn ?? '') && waiver.expires <= waiver.proposedOn) {
        problems.push(`${label}: expires is not after proposedOn`);
      }
      if (waiver.expires < today) {
        problems.push(
          `${label}: expired ${waiver.expires} — retest required (owner ${waiver.owner})`,
        );
      }
    }
    if (seen.has(waiver.advisory)) problems.push(`${label}: duplicate advisory entry`);
    seen.add(waiver.advisory);
  });
  return problems;
}

/** Match advisories against waivers. Both inputs are pre-validated.
 * Returns:
 *  - failures: unwaived high/critical advisories, orphaned waivers, and
 *    waivers whose recorded package/severity does not match the report;
 *  - holds: advisories matched only by PROPOSED (unratified) waivers;
 *  - notes: informational lines (never claiming unratified approval);
 *  - matchedAdvisories: [{ghsa, package}] with the package name taken
 *    from the LIVE report, for compensating controls. */
export function evaluateAudit(auditReport, waiverFile, today) {
  const failures = [];
  const holds = [];
  const notes = [];
  const matchedAdvisories = [];
  const waivers = new Map((waiverFile.waivers ?? []).map((w) => [w.advisory, w]));
  const matchedWaivers = new Set();
  const seen = new Set();
  for (const vuln of Object.values(auditReport.vulnerabilities ?? {})) {
    for (const via of vuln.via ?? []) {
      if (typeof via !== 'object' || via === null) continue;
      const ghsa = (via.url ?? '').split('/').pop() ?? '';
      if (seen.has(ghsa)) continue;
      seen.add(ghsa);
      if (via.severity !== 'high' && via.severity !== 'critical') {
        notes.push(`info: ${via.severity} ${ghsa} (${via.name}) below the high gate`);
        continue;
      }
      const waiver = waivers.get(ghsa);
      if (!waiver) {
        failures.push(`unwaived ${via.severity} advisory ${ghsa} (${via.name})`);
        continue;
      }
      // The waiver must describe the advisory as the report sees it:
      // a package or severity mismatch means the waiver no longer covers
      // what it claims to cover (drift or tampering) and fails closed.
      if (waiver.package !== via.name) {
        failures.push(
          `waiver ${ghsa} records package "${waiver.package}" but the report says "${via.name}" — waiver does not match the live report`,
        );
        continue;
      }
      if (waiver.severity !== via.severity) {
        failures.push(
          `waiver ${ghsa} records severity "${waiver.severity}" but the report says "${via.severity}" — waiver does not match the live report`,
        );
        continue;
      }
      matchedWaivers.add(ghsa);
      matchedAdvisories.push({ ghsa, package: via.name });
      if (waiver.approvalStatus === 'ratified') {
        notes.push(
          `waived (ratified ${waiver.ratifiedOn}): ${ghsa} (${via.name}) by ${waiver.owner} until ${waiver.expires}`,
        );
      } else {
        holds.push(
          `HOLD: ${via.severity} ${ghsa} (${via.name}) is matched by a PROPOSED waiver (owner ${waiver.owner}, expires ${waiver.expires}) awaiting explicit written ratification`,
        );
      }
    }
  }
  // Orphaned waivers prove the advisory is no longer present: the entry
  // must be removed, not silently retained.
  for (const advisory of waivers.keys()) {
    if (!matchedWaivers.has(advisory)) {
      failures.push(`orphaned waiver ${advisory}: no matching advisory in the current audit`);
    }
  }
  void today; // dates already enforced by validateWaivers
  return { failures, holds, notes, matchedAdvisories, advisoryCount: seen.size };
}

/** File-signature detection for the parsers the image-size advisories
 * cover. Returns 'icns' | 'jxl' | 'heif' | null for the first bytes of a
 * file (16 bytes suffice for all three). */
export function detectProhibitedAssetPayload(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return null;
  if (buffer.subarray(0, 4).toString('latin1') === 'icns') return 'icns';
  // JXL: bare codestream FF 0A, or the ISO-BMFF container signature.
  if (buffer[0] === 0xff && buffer[1] === 0x0a) return 'jxl';
  const jxlContainer = Buffer.from([0, 0, 0, 0x0c, 0x4a, 0x58, 0x4c, 0x20, 0x0d, 0x0a, 0x87, 0x0a]);
  if (buffer.length >= 12 && buffer.subarray(0, 12).equals(jxlContainer)) return 'jxl';
  // HEIF/HEIC: ISO-BMFF ftyp with a HEIF-family brand.
  if (buffer.length >= 12 && buffer.subarray(4, 8).toString('latin1') === 'ftyp') {
    const brand = buffer.subarray(8, 12).toString('latin1');
    if (
      [
        'heic',
        'heix',
        'hevc',
        'hevx',
        'heim',
        'heis',
        'hevm',
        'hevs',
        'mif1',
        'msf1',
        'heif',
      ].includes(brand)
    ) {
      return 'heif';
    }
  }
  return null;
}

const PROHIBITED_ASSET_EXTENSIONS = new Set(['.icns', '.jxl', '.heif', '.heic']);

/** Compensating control (P2-11, hardened): while any advisory MATCHED IN
 * THE LIVE REPORT affects image-size, the vulnerable parsers must have
 * nothing to parse — no tracked file may carry a prohibited extension OR
 * a prohibited file signature (readHead returns the first bytes of a
 * file, or null when unreadable — unreadable fails closed). */
export function checkProhibitedAssets(matchedAdvisories, trackedFiles, readHead) {
  const active = matchedAdvisories.some((advisory) => advisory.package === 'image-size');
  if (!active) return [];
  const failures = [];
  for (const file of trackedFiles) {
    const extension = path.extname(file).toLowerCase();
    if (PROHIBITED_ASSET_EXTENSIONS.has(extension)) {
      failures.push(
        `prohibited asset while image-size is vulnerable: ${file} (${extension} extension feeds the vulnerable parser)`,
      );
      continue;
    }
    const head = readHead(file);
    if (head === null) {
      failures.push(`prohibited-asset check could not read ${file} — failing closed`);
      continue;
    }
    const kind = detectProhibitedAssetPayload(head);
    if (kind) {
      failures.push(
        `prohibited asset while image-size is vulnerable: ${file} (${kind} file signature despite its extension)`,
      );
    }
  }
  return failures;
}

export function runNpmAudit(env = process.env) {
  const result = spawnSync('npm', ['audit', '--json'], {
    cwd: appRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
    env,
  });
  return {
    spawnError: result.error ?? null,
    signal: result.signal ?? null,
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function engineFail(message, detail) {
  if (detail) console.error(detail);
  console.error(`audit:gate ENGINE FAILURE: ${message}`);
  process.exit(2);
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  const run = runNpmAudit();
  if (run.spawnError) {
    engineFail(`could not spawn npm (${run.spawnError.code ?? run.spawnError.message})`);
  }
  if (run.signal) {
    engineFail(`npm terminated by signal ${run.signal}`, run.stderr);
  }
  // npm audit exits 0 (clean) or 1 (vulnerabilities); anything else is an
  // engine/registry problem, whatever stdout says.
  if (run.status !== 0 && run.status !== 1) {
    engineFail(`npm exited ${run.status}`, run.stderr || run.stdout);
  }
  if (!run.stdout.trim()) {
    engineFail('npm produced no output', run.stderr);
  }
  let report;
  try {
    report = JSON.parse(run.stdout);
  } catch {
    engineFail('npm output was not valid JSON', run.stderr || run.stdout.slice(0, 2000));
  }
  const reportProblems = validateAuditReport(report);
  if (reportProblems.length > 0) {
    // A report that fails schema validation or whose summary does not
    // reconcile with its own nodes cannot be trusted at all: engine class.
    engineFail(reportProblems.join('; '), run.stderr);
  }

  const waiverPath =
    process.env.HIVE_WAIVERS_PATH ?? path.join(appRoot, 'security', 'waivers.json');
  let waiverFile;
  try {
    waiverFile = JSON.parse(readFileSync(waiverPath, 'utf8'));
  } catch {
    engineFail(`waiver file unreadable at ${waiverPath}`);
  }
  const today = new Date().toISOString().slice(0, 10);
  const waiverProblems = validateWaivers(waiverFile, today);
  if (waiverProblems.length > 0) {
    for (const problem of waiverProblems) console.error(`FAIL ${problem}`);
    console.error('audit:gate FAILED (waiver validation)');
    process.exit(1);
  }
  const { failures, holds, notes, matchedAdvisories, advisoryCount } = evaluateAudit(
    report,
    waiverFile,
    today,
  );
  // Advisory SOURCES and affected package NODES are different counts —
  // npm's metadata tallies nodes; keep the two visibly distinct.
  console.log(
    `audit:gate: ${advisoryCount} distinct advisory source(s) across ${Object.keys(report.vulnerabilities).length} affected package node(s)`,
  );
  let trackedFiles;
  try {
    trackedFiles = execFileSync('git', ['ls-files'], { cwd: appRoot, encoding: 'utf8' })
      .split('\n')
      .filter(Boolean);
  } catch {
    engineFail('git ls-files failed — cannot verify prohibited assets');
  }
  const readHead = (file) => {
    try {
      const fd = openSync(path.join(appRoot, file), 'r');
      const buffer = Buffer.alloc(16);
      const bytes = readSync(fd, buffer, 0, 16, 0);
      closeSync(fd);
      return buffer.subarray(0, bytes);
    } catch {
      return null;
    }
  };
  failures.push(...checkProhibitedAssets(matchedAdvisories, trackedFiles, readHead));
  for (const note of notes) console.log(note);
  if (failures.length > 0) {
    for (const failure of failures) console.error(`FAIL ${failure}`);
    console.error('audit:gate FAILED');
    process.exit(1);
  }
  if (holds.length > 0) {
    for (const hold of holds) console.log(hold);
    console.log(
      'audit:gate HOLD — matched waivers are PROPOSED, not ratified; the audit lane stays HOLD until Kody ratifies in writing (exit 3)',
    );
    process.exit(3);
  }
  console.log(
    'audit:gate OK (high/critical advisories all covered by ratified, unexpired waivers; no prohibited assets)',
  );
}
