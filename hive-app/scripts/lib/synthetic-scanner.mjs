/** HiveSyntheticScanner — the NAMED SYNTHETIC scan for the local lane
 * (WO-003).
 *
 * No real malware scanner exists yet; approving one is Kody's decision
 * (HOLD). Until then the local quarantine tooling runs this scanner, which
 * proves the part of the contract that is HIVE's regardless of which
 * scanner is eventually chosen: the object that arrived is compared
 * against what the phone declared — exact byte size and SHA-256 — and a
 * planted synthetic marker stands in for a detection. Every verdict is
 * recorded through the same server functions a real scanner would use.
 *
 * Production-inert by construction: the tooling that runs it refuses any
 * non-loopback URL, and nothing in the app or the migrations references
 * this module.
 */
import { createHash } from 'node:crypto';

export const SCANNER_NAME = 'HiveSyntheticScanner';

/** A clearly synthetic detection marker. A test fixture carrying these
 * bytes is "malware" to this scanner and to nothing else in the world. */
export const SYNTHETIC_MALWARE_MARKER = 'HIVE-SYNTHETIC-MALWARE-MARKER';

export const REJECTION_REASONS = [
  'digest_mismatch',
  'size_mismatch',
  'unsupported_content',
  'malware_detected',
  'scan_failed',
];

export function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/** The verdict for one quarantined object.
 *
 * Order matters and is deliberate: size before digest (a truncated
 * transfer is a size mismatch, not a "wrong file"), the marker last (a
 * file that is not even the declared one is rejected for that reason). */
export function scanVerdict({ bytes, declaredByteSize, declaredDigest }) {
  if (!(bytes instanceof Uint8Array)) {
    return { verdict: 'rejected', reason: 'scan_failed' };
  }
  if (bytes.byteLength !== declaredByteSize) {
    return { verdict: 'rejected', reason: 'size_mismatch' };
  }
  if (sha256Hex(bytes) !== declaredDigest) {
    return { verdict: 'rejected', reason: 'digest_mismatch' };
  }
  if (Buffer.from(bytes).includes(SYNTHETIC_MALWARE_MARKER)) {
    return { verdict: 'rejected', reason: 'malware_detected' };
  }
  return { verdict: 'accepted', reason: null };
}

/** A one-line summary per document for the operator: ids and outcomes
 * only, never a name, a digest, or a byte of content. */
export function describeOutcome(uploadId, outcome) {
  const reason = outcome.reason ? ` (${outcome.reason})` : '';
  return `${SCANNER_NAME}: ${uploadId} -> ${outcome.verdict}${reason}`;
}
