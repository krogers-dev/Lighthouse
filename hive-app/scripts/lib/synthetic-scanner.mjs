/** HiveSyntheticScanner — the NAMED SYNTHETIC scan for the local lane
 * (WO-003).
 *
 * Until WO-015 no real malware scanner existed; approving one was Kody's
 * decision, made on 2026-09-30 (ClamAV, `scripts/lib/clamav.mjs`). The
 * local quarantine tooling still runs this scanner by default, which
 * proves the part of the contract that is HIVE's regardless of engine:
 * the object that arrived is compared against what the phone declared —
 * exact byte size and SHA-256 — and a planted synthetic marker stands in
 * for a detection. Every verdict is recorded through the same server
 * functions the ClamAV runner uses.
 *
 * Production-inert by construction: the tooling that runs it refuses any
 * non-loopback URL, and nothing in the app or the migrations references
 * this module.
 */
import {
  REJECTION_REASONS as PIPELINE_REASONS,
  declarationProblem,
  describeOutcome as describePipelineOutcome,
  sha256Hex as pipelineSha256Hex,
  verdictFromDetection,
} from './scan-pipeline.mjs';

export const SCANNER_NAME = 'HiveSyntheticScanner';
export const SCANNER_VERSION = 'synthetic';

/** A clearly synthetic detection marker. A test fixture carrying these
 * bytes is "malware" to this scanner and to nothing else in the world. */
export const SYNTHETIC_MALWARE_MARKER = 'HIVE-SYNTHETIC-MALWARE-MARKER';

export const REJECTION_REASONS = PIPELINE_REASONS;

export const sha256Hex = pipelineSha256Hex;

/** The synthetic engine: the marker is a detection, anything else is
 * clean. Synchronous, so the verdict below stays synchronous for its
 * callers and tests. */
export function detectMarker(bytes) {
  return Buffer.from(bytes).includes(SYNTHETIC_MALWARE_MARKER)
    ? { status: 'infected', signature: 'Hive.Synthetic.Marker' }
    : { status: 'clean' };
}

/** The verdict for one quarantined object: the declaration first (size
 * before digest), the marker last. */
export function scanVerdict({ bytes, declaredByteSize, declaredDigest }) {
  const problem = declarationProblem({ bytes, declaredByteSize, declaredDigest });
  if (problem) return problem;
  const outcome = verdictFromDetection(detectMarker(bytes));
  return { verdict: outcome.verdict, reason: outcome.reason };
}

/** A one-line summary per document for the operator: ids and outcomes
 * only, never a name, a digest, or a byte of content. */
export function describeOutcome(uploadId, outcome) {
  return describePipelineOutcome(SCANNER_NAME, uploadId, {
    verdict: outcome.verdict,
    reason: outcome.reason,
  });
}
