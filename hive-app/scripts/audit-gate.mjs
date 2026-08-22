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
import { manifestSha256, verifyRatification } from './lib/ratification.mjs';
import { createHash } from 'node:crypto';
import { openSync, readSync, closeSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const GHSA_PATTERN = /^GHSA(-[a-z0-9]{4}){3}$/;
// Only the canonical GitHub advisory URL yields an id — trailing slashes,
// other hosts, and malformed tails are rejected, never silently skipped
// (RETURN-4 P1-5).
const ADVISORY_URL = /^https:\/\/github\.com\/advisories\/(GHSA(?:-[a-z0-9]{4}){3})$/;

export function advisoryIdFromUrl(url) {
  const match = ADVISORY_URL.exec(url ?? '');
  return match ? match[1] : null;
}
const SHA256_HEX = /^[0-9a-f]{64}$/;
const PENDING_WORDS = /pending|proposed|not\s+approved|not\s+yet\s+given/i;
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
      if (advisoryIdFromUrl(via.url) === null) {
        problems.push(
          `${label}: advisory via entry url is not a canonical GitHub advisory url yielding a GHSA id`,
        );
      }
    }
  }
  // Via-graph resolution (RETURN-4 P1-5): every string via must name an
  // existing node; every node must transitively reach the advisories it
  // claims; dangling references, unresolved high/critical nodes, and node
  // severities that do not match the reached advisories all fail — a high
  // node can no longer evaluate as zero advisories.
  //
  // Cycles are TRAVERSED SAFELY, not rejected: real npm reports contain
  // them legitimately (metro <-> metro-config <-> metro-transform-worker
  // in this very lockfile), so refusing them would make the gate
  // permanently unrunnable rather than strict. Termination comes from the
  // visited set, and the security property the cycle rule was meant to
  // protect is enforced directly below: any high/critical node that
  // reaches ZERO advisories fails, so a cycle cannot be used to hide an
  // unresolved finding.
  const nodes = report.vulnerabilities;
  const reportedDangling = new Set();
  const resolveAdvisories = (start) => {
    const seenNodes = new Set([start]);
    const queue = [start];
    const reached = [];
    const reachedKeys = new Set();
    while (queue.length > 0) {
      const name = queue.shift();
      const node = nodes[name];
      if (typeof node !== 'object' || node === null || !Array.isArray(node.via)) continue;
      for (const via of node.via) {
        if (typeof via === 'string') {
          if (!(via in nodes)) {
            const key = `${name}->${via}`;
            if (!reportedDangling.has(key)) {
              reportedDangling.add(key);
              problems.push(`node "${name}": via reference "${via}" does not resolve to any node`);
            }
            continue;
          }
          if (!seenNodes.has(via)) {
            seenNodes.add(via);
            queue.push(via);
          }
        } else if (typeof via === 'object' && via !== null) {
          const key = `${via.url ?? ''}|${via.name ?? ''}|${via.severity ?? ''}`;
          if (!reachedKeys.has(key)) {
            reachedKeys.add(key);
            reached.push(via);
          }
        }
      }
    }
    return reached;
  };
  const rank = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };
  for (const [name, node] of Object.entries(nodes)) {
    if (typeof node !== 'object' || node === null || !SEVERITY_SET.has(node.severity)) continue;
    const reached = resolveAdvisories(name);
    if (reached.length === 0) {
      if (node.severity === 'high' || node.severity === 'critical') {
        problems.push(
          `node "${name}" is ${node.severity} but resolves to ZERO advisories through its via graph`,
        );
      }
      continue;
    }
    const worstReached = reached.reduce(
      (worst, via) => ((rank[via.severity] ?? -1) > (rank[worst] ?? -1) ? via.severity : worst),
      'info',
    );
    if (worstReached !== node.severity) {
      problems.push(
        `node "${name}" severity ${node.severity} does not reconcile with the advisories reached through its via graph (worst reached: ${worstReached})`,
      );
    }
  }
  // Cross-occurrence consistency (RETURN-3 area 1): the same GHSA may
  // appear under several nodes, but every occurrence must describe ONE
  // advisory — one package, one severity, one identity. A conflict means
  // the report cannot be trusted (and is exactly the shape that once
  // bypassed the high gate via dedup-before-evaluation).
  const occurrencesByGhsa = new Map();
  for (const node of Object.values(report.vulnerabilities)) {
    if (typeof node !== 'object' || node === null || !Array.isArray(node.via)) continue;
    for (const via of node.via) {
      if (typeof via !== 'object' || via === null) continue;
      const ghsa = advisoryIdFromUrl(via.url);
      if (!ghsa) continue;
      const occurrences = occurrencesByGhsa.get(ghsa) ?? [];
      occurrences.push({ name: via.name, severity: via.severity, url: via.url });
      occurrencesByGhsa.set(ghsa, occurrences);
    }
  }
  for (const [ghsa, occurrences] of occurrencesByGhsa) {
    const packages = new Set(occurrences.map((o) => o.name));
    const severities = new Set(occurrences.map((o) => o.severity));
    const urls = new Set(occurrences.map((o) => o.url));
    if (packages.size > 1) {
      problems.push(
        `conflicting occurrences of ${ghsa}: more than one package (${[...packages].join(', ')})`,
      );
    }
    if (severities.size > 1) {
      problems.push(
        `conflicting occurrences of ${ghsa}: more than one severity (${[...severities].join(', ')})`,
      );
    }
    if (urls.size > 1) {
      problems.push(`conflicting occurrences of ${ghsa}: more than one advisory url`);
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
  if (!Number.isInteger(summary.total) || summary.total < 0) {
    problems.push('metadata.vulnerabilities.total is required as a non-negative integer');
  } else if (summary.total !== total) {
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
    if (typeof waiver.reason !== 'string' || waiver.reason.trim().length < 10)
      problems.push(`${label}: missing or trivial reason (whitespace cannot satisfy it)`);
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
      // Ratification provenance (RETURN-3 area 3): a ratified entry
      // carries WHO approved, WHEN, the exact approval reference, the
      // decision-record digest, and the lockfile digest the approval
      // covered. `owner` is the accountable maintainer, never proof of
      // approval.
      if (typeof waiver.ratifiedBy !== 'string' || waiver.ratifiedBy.trim().length === 0) {
        problems.push(`${label}: ratified entries require ratifiedBy (a named approver)`);
      }
      if (!isRealIsoDate(waiver.ratifiedOn ?? '')) {
        problems.push(`${label}: ratified entries require a real ratifiedOn date`);
      } else {
        if (isRealIsoDate(waiver.proposedOn ?? '') && waiver.ratifiedOn < waiver.proposedOn) {
          problems.push(`${label}: ratifiedOn cannot precede proposedOn`);
        }
        if (waiver.ratifiedOn > today) {
          problems.push(`${label}: ratifiedOn is in the future — rejected`);
        }
        if (isRealIsoDate(waiver.expires ?? '') && waiver.ratifiedOn > waiver.expires) {
          problems.push(`${label}: ratification after expiry is rejected`);
        }
      }
      if (
        typeof waiver.decisionRecordPath !== 'string' ||
        !waiver.decisionRecordPath.startsWith('security/decisions/')
      ) {
        problems.push(
          `${label}: ratified entries require decisionRecordPath under security/decisions/`,
        );
      }
      if (
        typeof waiver.approvalReference !== 'string' ||
        waiver.approvalReference.trim().length === 0
      ) {
        problems.push(`${label}: ratified entries require a non-blank approvalReference`);
      } else if (PENDING_WORDS.test(waiver.approvalReference)) {
        problems.push(
          `${label}: approvalReference still reads as pending/proposed — that is not an approval reference`,
        );
      }
      if (!SHA256_HEX.test(waiver.decisionRecordDigest ?? '')) {
        problems.push(
          `${label}: ratified entries require decisionRecordDigest (sha256 hex of the decision record)`,
        );
      }
      if (!SHA256_HEX.test(waiver.lockfileSha256 ?? '')) {
        problems.push(
          `${label}: ratified entries require lockfileSha256 binding the approval to the dependency evidence`,
        );
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
  // EVERY occurrence of a GHSA is collected before any deduplication
  // (RETURN-3 area 1): the once-shipped seen-set skipped later
  // occurrences, so moderate-first/high-second passed unwaived. Each
  // unique advisory is then judged once at its WORST observed severity
  // (conflicting occurrences are already an engine/schema failure in
  // validateAuditReport; this is defense in depth).
  const severityRank = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };
  const byGhsa = new Map();
  for (const vuln of Object.values(auditReport.vulnerabilities ?? {})) {
    for (const via of vuln.via ?? []) {
      if (typeof via !== 'object' || via === null) continue;
      const ghsa = advisoryIdFromUrl(via.url);
      if (!ghsa) continue; // schema validation already failed such reports
      const current = byGhsa.get(ghsa);
      if (!current || (severityRank[via.severity] ?? 0) > (severityRank[current.severity] ?? 0)) {
        byGhsa.set(ghsa, { severity: via.severity, name: via.name });
      }
    }
  }
  for (const [ghsa, worst] of byGhsa) {
    if (worst.severity !== 'high' && worst.severity !== 'critical') {
      notes.push(`info: ${worst.severity} ${ghsa} (${worst.name}) below the high gate`);
      continue;
    }
    const waiver = waivers.get(ghsa);
    if (!waiver) {
      failures.push(`unwaived ${worst.severity} advisory ${ghsa} (${worst.name})`);
      continue;
    }
    // The waiver must describe the advisory as the report sees it:
    // a package or severity mismatch means the waiver no longer covers
    // what it claims to cover (drift or tampering) and fails closed.
    if (waiver.package !== worst.name) {
      failures.push(
        `waiver ${ghsa} records package "${waiver.package}" but the report says "${worst.name}" — waiver does not match the live report`,
      );
      continue;
    }
    if (waiver.severity !== worst.severity) {
      failures.push(
        `waiver ${ghsa} records severity "${waiver.severity}" but the report says "${worst.severity}" — waiver does not match the live report`,
      );
      continue;
    }
    matchedWaivers.add(ghsa);
    matchedAdvisories.push({ ghsa, package: worst.name });
    if (waiver.approvalStatus === 'ratified') {
      notes.push(
        `waived (ratified ${waiver.ratifiedOn} by ${waiver.ratifiedBy}; owner: ${waiver.owner}): ${ghsa} (${worst.name}) until ${waiver.expires}`,
      );
    } else {
      holds.push(
        `HOLD: ${worst.severity} ${ghsa} (${worst.name}) is matched by a PROPOSED waiver (owner ${waiver.owner}, expires ${waiver.expires}) awaiting explicit written ratification`,
      );
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
  return { failures, holds, notes, matchedAdvisories, advisoryCount: byGhsa.size };
}

/** File-signature detection for the parsers the image-size advisories
 * cover (RETURN-3 area 2: advisory-derived shapes). Detects:
 *  - ICNS containers ('icns' magic);
 *  - JXL: bare codestream (FF 0A) and the ISO-BMFF 'JXL ' signature box
 *    REGARDLESS of the 4-byte box size — the advisory's exploit shape is
 *    a zero-size box (00 00 00 00 'JXL ') meaning "extends to EOF";
 *  - HEIF/AVIF families: any 'ftyp' box (any size field, zero included)
 *    whose major brand OR any compatible brand visible in the head is in
 *    the family.
 * Returns 'icns' | 'jxl' | 'heif' | 'avif' | null. Hand it at least 64
 * bytes so compatible-brand lists are visible. */
const HEIF_BRANDS = new Set([
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
]);
const AVIF_BRANDS = new Set(['avif', 'avis', 'avci', 'avcs']);

export function detectProhibitedAssetPayload(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return null;
  if (buffer.subarray(0, 4).toString('latin1') === 'icns') return 'icns';
  // JXL: bare codestream FF 0A.
  if (buffer[0] === 0xff && buffer[1] === 0x0a) return 'jxl';
  if (buffer.length >= 8) {
    const boxType = buffer.subarray(4, 8).toString('latin1');
    // JXL container signature box, whatever its size field says.
    if (boxType === 'JXL ') return 'jxl';
    // HEIF/AVIF: 'ftyp' box, any size field. Check the major brand and
    // every compatible brand visible in the head (compatible brands
    // follow the 4-byte minor version at offset 16, in 4-byte cells).
    if (boxType === 'ftyp' && buffer.length >= 12) {
      const brands = [buffer.subarray(8, 12).toString('latin1')];
      for (let offset = 16; offset + 4 <= buffer.length; offset += 4) {
        brands.push(buffer.subarray(offset, offset + 4).toString('latin1'));
      }
      if (brands.some((brand) => AVIF_BRANDS.has(brand))) return 'avif';
      if (brands.some((brand) => HEIF_BRANDS.has(brand))) return 'heif';
    }
  }
  return null;
}

export const PROHIBITED_ASSET_EXTENSIONS = new Set(['.icns', '.jxl', '.heif', '.heic', '.avif']);
/** Extensions that read as build images: while the control is active,
 * every such file must be on the positive allowlist AND match its
 * approved signature — a renamed crafted payload fails either way. */
export const IMAGE_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.bmp',
  '.ico',
  '.tiff',
  '.tif',
  // RETURN-4 P1-7: Metro's default asset list includes PSD and SVG, so
  // they are governed image formats here too; a drift test asserts every
  // image-like extension in the PINNED metro-config defaults is covered
  // by this set or the prohibited set.
  '.svg',
  '.psd',
]);
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** Positive allowlist: HIVE build images are PNGs, full stop. */
const APPROVED_IMAGE_SIGNATURES = new Map([['.png', PNG_SIGNATURE]]);

/** Compensating control (P2-11; RETURN-3 area 2): while any advisory
 * MATCHED IN THE LIVE REPORT affects image-size, the vulnerable parsers
 * must have nothing to parse. Three fail-closed layers:
 *  1. no tracked file may carry a prohibited extension;
 *  2. no tracked file of ANY extension may carry a prohibited signature;
 *  3. positive allowlist — every file with an image extension must use an
 *     APPROVED extension (.png) and match that extension's approved
 *     signature exactly.
 * readHead returns the first bytes of a file (64 recommended) or null
 * when unreadable; unreadable fails closed. */
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
      continue;
    }
    if (IMAGE_EXTENSIONS.has(extension)) {
      const approved = APPROVED_IMAGE_SIGNATURES.get(extension);
      if (!approved) {
        failures.push(
          `build image ${file} does not use an approved safe extension while image-size is vulnerable (approved: ${[...APPROVED_IMAGE_SIGNATURES.keys()].join(', ')})`,
        );
        continue;
      }
      if (head.length < approved.length || !head.subarray(0, approved.length).equals(approved)) {
        failures.push(
          `build image ${file} does not carry its extension's approved signature while image-size is vulnerable`,
        );
      }
    }
  }
  return failures;
}

/** A ratified waiver approves a SPECIFIC dependency state: its
 * lockfileSha256 must equal the current lockfile digest, or the material
 * changed after approval and the approval no longer covers it. */
export function checkWaiverBindings(waivers, currentLockfileSha256) {
  const failures = [];
  for (const waiver of waivers) {
    if (waiver.approvalStatus !== 'ratified') continue;
    if (waiver.lockfileSha256 !== currentLockfileSha256) {
      failures.push(
        `ratified waiver ${waiver.advisory} is bound to a different lockfile digest — the dependency evidence changed after approval; re-approval required`,
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
  // Exit-status/report reconciliation (RETURN-4 P1-5): npm exits 0 only
  // for a clean report and 1 only when it found something.
  const reportedTotal = report.metadata.vulnerabilities.total;
  if (run.status === 0 && reportedTotal !== 0) {
    engineFail(`npm exited 0 but the report totals ${reportedTotal} vulnerabilities`);
  }
  if (run.status === 1 && reportedTotal === 0) {
    engineFail('npm exited 1 (findings) but the report totals zero vulnerabilities');
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
  // Ratified approvals are bound to the dependency evidence they covered.
  let lockfileSha256;
  try {
    lockfileSha256 = createHash('sha256')
      .update(readFileSync(path.join(appRoot, 'package-lock.json')))
      .digest('hex');
  } catch {
    engineFail('package-lock.json unreadable — cannot verify waiver bindings');
  }
  failures.push(...checkWaiverBindings(waiverFile.waivers ?? [], lockfileSha256));
  // Verifiable ratification (RETURN-4 P1-6): any ratified entry must
  // resolve its immutable decision record with every binding intact and
  // the digest presented out-of-band.
  const ratifiedWaivers = (waiverFile.waivers ?? []).filter((w) => w.approvalStatus === 'ratified');
  if (ratifiedWaivers.length > 0) {
    let candidateSha = process.env.HIVE_CANDIDATE_SHA ?? '';
    if (!candidateSha) {
      try {
        candidateSha = execFileSync('git', ['rev-parse', 'HEAD'], {
          cwd: appRoot,
          encoding: 'utf8',
        }).trim();
      } catch {
        engineFail('cannot resolve the candidate commit for ratification verification');
      }
    }
    let rawAuditSha256;
    try {
      rawAuditSha256 = createHash('sha256')
        .update(readFileSync(path.join(appRoot, 'security', 'evidence', 'npm-audit-current.json')))
        .digest('hex');
    } catch {
      engineFail('archived raw-audit evidence unreadable — cannot verify ratification bindings');
    }
    const approvalDigests = new Set(
      (process.env.HIVE_APPROVAL_DIGESTS ?? '')
        .split(',')
        .map((digest) => digest.trim())
        .filter(Boolean),
    );
    const context = {
      readFile: (relative) => {
        try {
          return readFileSync(path.join(appRoot, relative));
        } catch {
          return null;
        }
      },
      todayIso: today,
      expectedAction: 'waiver-ratification',
      manifestSha256: manifestSha256(waiverFile.waivers ?? []),
      currentLockfileSha256: lockfileSha256,
      currentRawAuditSha256: rawAuditSha256,
      candidateSha,
      approvalDigests,
    };
    for (const waiver of ratifiedWaivers) {
      failures.push(...verifyRatification(waiver, context));
    }
  }
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
      const buffer = Buffer.alloc(64);
      const bytes = readSync(fd, buffer, 0, 64, 0);
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
