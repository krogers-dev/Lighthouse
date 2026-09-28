import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  SCANNER_NAME,
  SYNTHETIC_MALWARE_MARKER,
  describeOutcome,
  scanVerdict,
  sha256Hex,
} from '../../scripts/lib/synthetic-scanner.mjs';

const bytes = new TextEncoder().encode('%PDF-1.4\n% HIVE synthetic (Synthetic)\n%%EOF\n');
const declared = { declaredByteSize: bytes.byteLength, declaredDigest: sha256Hex(bytes) };

test('accepts an object whose size and digest are exactly what the phone declared', () => {
  assert.deepEqual(scanVerdict({ bytes, ...declared }), { verdict: 'accepted', reason: null });
});

test('a truncated transfer is a size mismatch before anything else is judged', () => {
  assert.deepEqual(scanVerdict({ bytes: bytes.subarray(0, 10), ...declared }), {
    verdict: 'rejected',
    reason: 'size_mismatch',
  });
});

test('same size, different bytes: a digest mismatch', () => {
  const swapped = Uint8Array.from(bytes);
  swapped[0] = swapped[0] ^ 0xff;
  assert.deepEqual(scanVerdict({ bytes: swapped, ...declared }), {
    verdict: 'rejected',
    reason: 'digest_mismatch',
  });
});

test('the synthetic marker is a detection when the declaration is otherwise honest', () => {
  const planted = new TextEncoder().encode(`%PDF-1.4\n${SYNTHETIC_MALWARE_MARKER}\n%%EOF\n`);
  assert.deepEqual(
    scanVerdict({
      bytes: planted,
      declaredByteSize: planted.byteLength,
      declaredDigest: sha256Hex(planted),
    }),
    { verdict: 'rejected', reason: 'malware_detected' },
  );
});

test('an unreadable object is a failed scan, never an acceptance', () => {
  assert.deepEqual(scanVerdict({ bytes: null, ...declared }), {
    verdict: 'rejected',
    reason: 'scan_failed',
  });
});

test('the operator line names the scanner, the id, and the outcome, and nothing else', () => {
  const line = describeOutcome('upload-1', { verdict: 'rejected', reason: 'digest_mismatch' });
  assert.equal(line, `${SCANNER_NAME}: upload-1 -> rejected (digest_mismatch)`);
  assert.equal(
    describeOutcome('upload-2', { verdict: 'accepted', reason: null }),
    `${SCANNER_NAME}: upload-2 -> accepted`,
  );
});
