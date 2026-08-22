/** Verifiable ratification (RETURN-4 P1-6). A repository field authored
 * by the implementer is not authority: clearing HOLD requires resolving a
 * real, immutable decision artifact and proving every binding.
 *
 * A ratified entry must reference a decision record
 * (`decisionRecordPath` under security/decisions/) whose recomputed
 * sha256 equals `decisionRecordDigest`. The record must bind: the
 * authorized approver (who must equal `ratifiedBy`), their role, the
 * exact action, the exact manifest digest of the approved entries, the
 * candidate commit, the lockfile digest, the raw-audit digest where
 * applicable, the destination, the approval time, and the expiry. Any
 * material change invalidates the approval.
 *
 * Trust anchor: the decision digest must ALSO be presented out-of-band
 * at verification time (HIVE_APPROVAL_DIGESTS, supplied by the approver
 * through a channel the implementer does not control). No signing key is
 * invented here; a fabricated in-repo record fails the out-of-band check
 * even if internally consistent. Pure over injected IO; unit-tested in
 * tests/scripts/ratification.test.mjs.
 */
import { createHash } from 'node:crypto';

/** Authorized approvers per the brief's authority model (Kody owns
 * security and capability decisions). */
export const AUTHORIZED_APPROVERS = new Set(['Kody']);

const SHA256_HEX = /^[0-9a-f]{64}$/;

export function sha256Hex(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

/** Ratification-only fields stripped before digesting what was approved:
 * the manifest describes the approved SUBSTANCE, so adding the approval
 * block later does not change it, while editing any substantive field
 * does. */
const RATIFICATION_FIELDS = new Set([
  'approvalStatus',
  'ratifiedOn',
  'ratifiedBy',
  'approvalReference',
  'decisionRecordPath',
  'decisionRecordDigest',
  'lockfileSha256',
]);

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === 'object' && value !== null) {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      if (RATIFICATION_FIELDS.has(key)) continue;
      out[key] = canonicalize(value[key]);
    }
    return out;
  }
  return value;
}

/** Digest of the approved entry set (order-independent). */
export function manifestSha256(entries) {
  const canonical = entries
    .map((entry) => JSON.stringify(canonicalize(entry)))
    .sort()
    .join('\n');
  return sha256Hex(Buffer.from(canonical, 'utf8'));
}

/** Verify one ratified entry against its decision artifact and bindings.
 * context: {
 *   readFile(path) -> Buffer|null,
 *   todayIso,
 *   expectedAction,           // 'waiver-ratification' | 'history-exception-ratification'
 *   manifestSha256,           // digest of the CURRENT entry set
 *   currentLockfileSha256?,   // required for waivers
 *   currentRawAuditSha256?,   // required when the decision binds one
 *   candidateSha,             // commit under verification
 *   approvalDigests,          // Set of out-of-band digests presented now
 * }
 * Returns human-readable problems; empty means verified. */
export function verifyRatification(entry, context) {
  const problems = [];
  const label = `ratification of ${entry.advisory ?? entry.blob ?? 'entry'}`;

  if (
    typeof entry.decisionRecordPath !== 'string' ||
    !entry.decisionRecordPath.startsWith('security/decisions/')
  ) {
    return [`${label}: decisionRecordPath must point into security/decisions/`];
  }
  const raw = context.readFile(entry.decisionRecordPath);
  if (raw === null) {
    return [`${label}: decision record ${entry.decisionRecordPath} does not exist`];
  }
  const recomputed = sha256Hex(raw);
  if (recomputed !== entry.decisionRecordDigest) {
    problems.push(
      `${label}: decision record digest mismatch — the record changed after ratification (or the digest was fabricated)`,
    );
    return problems;
  }
  // Out-of-band anchor: the digest must be presented through the trusted
  // channel at verification time.
  if (!context.approvalDigests?.has(recomputed)) {
    problems.push(
      `${label}: approval material not presented out-of-band (HIVE_APPROVAL_DIGESTS) — a repository record alone is not authority`,
    );
  }
  let decision;
  try {
    decision = JSON.parse(raw.toString('utf8'));
  } catch {
    return [...problems, `${label}: decision record is not valid JSON`];
  }
  if (!AUTHORIZED_APPROVERS.has(decision.approver)) {
    problems.push(
      `${label}: approver ${JSON.stringify(decision.approver)} is not an authorized approver`,
    );
  }
  if (decision.approver !== entry.ratifiedBy) {
    problems.push(
      `${label}: ratifiedBy (${entry.ratifiedBy}) does not match the decision approver`,
    );
  }
  if (typeof decision.role !== 'string' || decision.role.trim() === '') {
    problems.push(`${label}: decision record names no authorized role`);
  }
  if (decision.action !== context.expectedAction) {
    problems.push(
      `${label}: decision action ${JSON.stringify(decision.action)} is not ${context.expectedAction}`,
    );
  }
  if (decision.manifestSha256 !== context.manifestSha256) {
    problems.push(
      `${label}: the approved manifest digest does not match the current entries — material change invalidates the approval`,
    );
  }
  if (
    !SHA256_HEX.test(decision.candidate ?? '') &&
    !/^[0-9a-f]{40}$/.test(decision.candidate ?? '')
  ) {
    problems.push(`${label}: decision record has no valid candidate commit`);
  } else if (context.candidateSha && decision.candidate !== context.candidateSha) {
    problems.push(
      `${label}: decision approves candidate ${decision.candidate}, not the one under verification`,
    );
  }
  if (context.currentLockfileSha256) {
    if (decision.lockfileSha256 !== context.currentLockfileSha256) {
      problems.push(`${label}: decision lockfile digest does not match the current lockfile`);
    }
    if (entry.lockfileSha256 !== context.currentLockfileSha256) {
      problems.push(`${label}: entry lockfile binding does not match the current lockfile`);
    }
  }
  if (context.currentRawAuditSha256 && decision.rawAuditSha256 !== context.currentRawAuditSha256) {
    problems.push(`${label}: decision raw-audit digest does not match the archived audit evidence`);
  }
  if (typeof decision.destination !== 'string' || decision.destination.trim() === '') {
    problems.push(`${label}: decision record names no destination`);
  }
  if (
    typeof decision.approvedAt !== 'string' ||
    decision.approvedAt.slice(0, 10) !== entry.ratifiedOn
  ) {
    problems.push(`${label}: decision approvedAt does not match ratifiedOn`);
  }
  if (
    typeof decision.expires !== 'string' ||
    (decision.expires !== entry.expires && decision.expires !== entry.expiry)
  ) {
    problems.push(`${label}: decision expiry does not match the entry expiry`);
  }
  return problems;
}
