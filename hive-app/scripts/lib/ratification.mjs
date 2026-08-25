/** Verifiable ratification (RETURN-4 P1-6, revised by the RETURN-5
 * ruling to the OUT-OF-BAND model).
 *
 * A repository field authored by the implementer is not authority, and
 * neither is a decision record committed beside the candidate it
 * approves: a record inside a commit cannot name that commit's own hash,
 * so an in-repo record can only ever bind some earlier commit. The
 * approval therefore lives OUTSIDE the repository entirely.
 *
 * The flow: the corrective child commit is built and pushed with every
 * entry still `proposed`; the approver then issues a decision record
 * naming that child's SHA and supplies it — with its digest — through a
 * channel the implementer does not control. Verification at the child
 * then resolves cleanly, because the record was written after the commit
 * it approves existed.
 *
 * At verification time the approver supplies:
 *   HIVE_APPROVAL_RECORDS  comma-separated paths to decision record files
 *                          that MUST live outside the repository
 *   HIVE_APPROVAL_DIGESTS  the sha256 digests, stated independently
 *
 * A ratified entry carries only `decisionRecordDigest`; it names no path,
 * because it must not be able to point at anything it controls. The
 * supplied record must bind: the authorized approver (who must equal
 * `ratifiedBy`), their role, the exact action, the exact manifest digest
 * of the approved entries, the candidate commit, the lockfile digest, the
 * raw-audit digest where applicable, the destination, the approval time,
 * and the expiry. Any material change invalidates the approval.
 *
 * No signing key is invented here. A record committed into the repository
 * is REFUSED outright, however internally consistent it is. Pure over
 * injected IO; unit-tested in tests/scripts/ratification.test.mjs.
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
 *   approvalRecords,          // Map<digest, Buffer> supplied OUT-OF-BAND
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

  // An entry may not name a location: it must not be able to point at
  // material the implementer controls. Any surviving path field is a
  // leftover from the in-repo model and is refused.
  if (typeof entry.decisionRecordPath === 'string' && entry.decisionRecordPath.trim() !== '') {
    problems.push(
      `${label}: decisionRecordPath is no longer accepted — the decision record is supplied out-of-band (HIVE_APPROVAL_RECORDS), never committed beside the candidate it approves`,
    );
  }
  const digest = entry.decisionRecordDigest;
  if (!SHA256_HEX.test(digest ?? '')) {
    return [
      ...problems,
      `${label}: decisionRecordDigest must be a sha256 hex digest of the approver's decision record`,
    ];
  }
  const raw = context.approvalRecords?.get(digest) ?? null;
  if (raw === null) {
    return [
      ...problems,
      `${label}: no out-of-band decision record with digest ${digest.slice(0, 12)}… was supplied (HIVE_APPROVAL_RECORDS) — an entry claiming ratification proves nothing on its own`,
    ];
  }
  const recomputed = sha256Hex(raw);
  if (recomputed !== digest) {
    return [
      ...problems,
      `${label}: decision record digest mismatch — the supplied record is not the approved one`,
    ];
  }
  // Second anchor: the digest must ALSO be stated independently, so
  // handing the gate a file is not by itself an approval.
  if (!context.approvalDigests?.has(recomputed)) {
    problems.push(
      `${label}: approval digest not presented out-of-band (HIVE_APPROVAL_DIGESTS) — supplying a record file alone is not authority`,
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

/** Load the decision records the approver supplied out-of-band.
 *
 * The one structural rule that makes this model real: a record inside the
 * repository is REFUSED. Approval material must live outside the artifact
 * it approves — otherwise it is back to a record that cannot name the
 * commit carrying it, and back to the implementer controlling both sides.
 *
 * `spec` is the raw HIVE_APPROVAL_RECORDS value (comma-separated paths).
 * `io` injects { realpath, readFile, repoRoot } for testability.
 * Returns { records: Map<digest, Buffer>, problems: string[] }. */
export function loadApprovalRecords(spec, io) {
  const records = new Map();
  const problems = [];
  const paths = String(spec ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  for (const candidatePath of paths) {
    let resolved;
    try {
      resolved = io.realpath(candidatePath);
    } catch {
      problems.push(`approval record ${candidatePath} does not exist`);
      continue;
    }
    if (isInside(io.repoRoot, resolved)) {
      problems.push(
        `approval record ${candidatePath} is inside the repository — approval material must live outside the candidate it approves`,
      );
      continue;
    }
    let buffer;
    try {
      buffer = io.readFile(resolved);
    } catch {
      problems.push(`approval record ${candidatePath} is unreadable`);
      continue;
    }
    records.set(sha256Hex(buffer), buffer);
  }
  return { records, problems };
}

/** Path containment without string-prefix confusion: `/repo-evil` is not
 * inside `/repo` (the same class of bug as the origin suffix hosts). */
function isInside(root, target) {
  if (typeof root !== 'string' || root === '') return false;
  const normalizedRoot = root.endsWith('/') ? root.slice(0, -1) : root;
  return target === normalizedRoot || target.startsWith(`${normalizedRoot}/`);
}
