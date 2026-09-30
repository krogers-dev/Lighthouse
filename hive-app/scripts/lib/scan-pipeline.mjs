/** What every scanner shares (WO-003, generalized for WO-015): the part
 * of the verdict that is HIVE's own, whichever engine looks for malware.
 *
 * The object that arrived is compared against what the phone declared —
 * exact byte size, then SHA-256 — before any engine sees it: a truncated
 * transfer is a size mismatch, not a "wrong file", and a file that is not
 * even the declared one is rejected for that reason rather than judged.
 * Only then does the engine's detection decide: clean is accepted, a
 * detection is `malware_detected`, and an engine that could not judge
 * (an error, an unreadable object) is `scan_failed` — a document nobody
 * can check is never accepted by default.
 *
 * Pure. The runners (the loopback synthetic lane and the ClamAV lane)
 * apply these to bytes they fetched and record the outcome through the
 * same server-role interface.
 */
import { createHash } from 'node:crypto';

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

/** The declaration check: null when the bytes are exactly what the phone
 * declared, otherwise the rejection. */
export function declarationProblem({ bytes, declaredByteSize, declaredDigest }) {
  if (!(bytes instanceof Uint8Array)) {
    return { verdict: 'rejected', reason: 'scan_failed' };
  }
  if (bytes.byteLength !== declaredByteSize) {
    return { verdict: 'rejected', reason: 'size_mismatch' };
  }
  if (sha256Hex(bytes) !== declaredDigest) {
    return { verdict: 'rejected', reason: 'digest_mismatch' };
  }
  return null;
}

/** An engine's detection as the recorded verdict. `detail` is a fact for
 * the operator's line (a signature name), never stored with a name of
 * the document. */
export function verdictFromDetection(detection) {
  if (detection?.status === 'clean') return { verdict: 'accepted', reason: null };
  if (detection?.status === 'infected') {
    return { verdict: 'rejected', reason: 'malware_detected', detail: detection.signature ?? null };
  }
  return {
    verdict: 'rejected',
    reason: 'scan_failed',
    detail: detection?.message ?? 'no detection result',
  };
}

/** The whole judgement for one object with a synchronous or asynchronous
 * detector: the declaration first, the engine only for an honest one. */
export async function judgeObject({ bytes, declaredByteSize, declaredDigest, detect }) {
  const problem = declarationProblem({ bytes, declaredByteSize, declaredDigest });
  if (problem) return problem;
  return verdictFromDetection(await detect(bytes));
}

/** A one-line summary per document for the operator: the scanner, the
 * id, and the outcome; a detection's signature name; never a document
 * name, a digest, or a byte of content. */
export function describeOutcome(scannerName, uploadId, outcome) {
  const reason = outcome.reason ? ` (${outcome.reason})` : '';
  const detail =
    outcome.reason === 'malware_detected' && outcome.detail ? ` [${outcome.detail}]` : '';
  return `${scannerName}: ${uploadId} -> ${outcome.verdict}${reason}${detail}`;
}
