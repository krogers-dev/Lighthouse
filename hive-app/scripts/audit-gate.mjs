#!/usr/bin/env node
/**
 * audit:gate — npm audit with recorded waivers, fail-closed (P1 item 6).
 *
 * `npm audit --audit-level=high` has no ignore mechanism, so this gate
 * runs the audit itself and fails on any high/critical advisory not
 * covered by an unexpired, well-formed waiver in security/waivers.json.
 *
 * Fail-closed contract: npm bootstrap/engine failures, registry errors,
 * signal termination, empty output, malformed JSON, invalid report
 * schemas, and malformed/duplicate/expired/orphaned waivers are all
 * distinct hard failures (exit 2 for engine trouble, exit 1 for findings
 * or waiver problems) — none of them can read as a clean report.
 * Integration-tested against a fake npm executable
 * (tests/scripts/audit-gate-integration.test.mjs).
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const GHSA_PATTERN = /^GHSA(-[a-z0-9]{4}){3}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SEVERITIES = new Set(['info', 'low', 'moderate', 'high', 'critical']);

/** Validate the shape npm audit --json is contractually expected to emit.
 * Returns a list of problems; empty means the report is usable. */
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
  }
  if (
    typeof report.metadata !== 'object' ||
    report.metadata === null ||
    typeof report.metadata.vulnerabilities !== 'object'
  ) {
    problems.push('report has no metadata.vulnerabilities summary');
  }
  return problems;
}

/** Validate waiver entries themselves. Returns problems; empty means ok. */
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
    if (!SEVERITIES.has(waiver.severity)) problems.push(`${label}: invalid severity`);
    if (typeof waiver.owner !== 'string' || waiver.owner.length === 0)
      problems.push(`${label}: missing owner`);
    if (typeof waiver.reason !== 'string' || waiver.reason.length < 10)
      problems.push(`${label}: missing or trivial reason`);
    if (!DATE_PATTERN.test(waiver.approvedOn ?? ''))
      problems.push(`${label}: malformed approvedOn`);
    if (!DATE_PATTERN.test(waiver.expires ?? '')) problems.push(`${label}: malformed expires`);
    if (
      DATE_PATTERN.test(waiver.approvedOn ?? '') &&
      DATE_PATTERN.test(waiver.expires ?? '') &&
      waiver.expires <= waiver.approvedOn
    ) {
      problems.push(`${label}: expires is not after approvedOn`);
    }
    if (DATE_PATTERN.test(waiver.expires ?? '') && waiver.expires < today) {
      problems.push(
        `${label}: expired ${waiver.expires} — retest required (owner ${waiver.owner})`,
      );
    }
    if (seen.has(waiver.advisory)) problems.push(`${label}: duplicate advisory entry`);
    seen.add(waiver.advisory);
  });
  return problems;
}

/** Match advisories against waivers. Both inputs are pre-validated. */
export function evaluateAudit(auditReport, waiverFile, today) {
  const failures = [];
  const notes = [];
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
      } else {
        matchedWaivers.add(ghsa);
        notes.push(`waived: ${ghsa} (${via.name}) by ${waiver.owner} until ${waiver.expires}`);
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
  const evaluatedToday = today; // dates already enforced by validateWaivers
  void evaluatedToday;
  return { failures, notes };
}

/** Compensating control for the image-size waivers (P2-11): while any
 * image-size advisory is waived rather than fixed, the vulnerable parsers
 * (ICNS, JXL, HEIF/HEIC) must have nothing to parse — no such build asset
 * may be tracked. Recheck monthly, on every lockfile or Expo change,
 * before any release candidate, and at expiry. */
const PROHIBITED_ASSET_EXTENSIONS = new Set(['.icns', '.jxl', '.heif', '.heic']);

export function checkProhibitedAssets(waiverFile, trackedFiles) {
  const imageSizeWaived = (waiverFile.waivers ?? []).some((w) => w.package === 'image-size');
  if (!imageSizeWaived) return [];
  const failures = [];
  for (const file of trackedFiles) {
    const extension = path.extname(file).toLowerCase();
    if (PROHIBITED_ASSET_EXTENSIONS.has(extension)) {
      failures.push(
        `prohibited asset while image-size is waived: ${file} (${extension} feeds the vulnerable parser)`,
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
  const { failures, notes } = evaluateAudit(report, waiverFile, today);
  let trackedFiles;
  try {
    trackedFiles = execFileSync('git', ['ls-files'], { cwd: appRoot, encoding: 'utf8' })
      .split('\n')
      .filter(Boolean);
  } catch {
    engineFail('git ls-files failed — cannot verify prohibited assets');
  }
  failures.push(...checkProhibitedAssets(waiverFile, trackedFiles));
  for (const note of notes) console.log(note);
  if (failures.length > 0) {
    for (const failure of failures) console.error(`FAIL ${failure}`);
    console.error('audit:gate FAILED');
    process.exit(1);
  }
  console.log(
    'audit:gate OK (high/critical advisories all covered by unexpired waivers; no prohibited assets)',
  );
}
