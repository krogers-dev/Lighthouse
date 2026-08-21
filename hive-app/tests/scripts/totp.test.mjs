import assert from 'node:assert/strict';
import { test } from 'node:test';

import { base32Decode, totpCode } from '../../scripts/lib/totp.mjs';

// RFC 6238 Appendix B vectors (SHA-1): ASCII secret "12345678901234567890".
const RFC_SECRET_B32 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

test('base32 decodes the RFC secret', () => {
  assert.equal(base32Decode(RFC_SECRET_B32).toString('ascii'), '12345678901234567890');
});

test('produces the RFC 6238 SHA-1 reference codes (last 6 digits)', () => {
  assert.equal(totpCode(RFC_SECRET_B32, 59 * 1000), '287082');
  assert.equal(totpCode(RFC_SECRET_B32, 1111111109 * 1000), '081804');
  assert.equal(totpCode(RFC_SECRET_B32, 1234567890 * 1000), '005924');
  assert.equal(totpCode(RFC_SECRET_B32, 20000000000 * 1000), '353130');
});

test('pads short codes to six digits', () => {
  const code = totpCode(RFC_SECRET_B32, 1111111109 * 1000);
  assert.equal(code.length, 6);
});

// ---------------------------------------------------------------------------
// RETURN-3 area 8: strict Base32 and window-safe wrong codes
// ---------------------------------------------------------------------------

test('strictBase32Decode accepts canonical encodings', async () => {
  const { strictBase32Decode } = await import('../../scripts/lib/totp.mjs');
  // 'foobar' canonical: MZXW6YTBOI====== ; 20-byte secrets: 32 chars, no pad.
  assert.equal(strictBase32Decode('MZXW6YTBOI======').toString('utf8'), 'foobar');
  assert.equal(strictBase32Decode('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ').length, 20);
  assert.equal(strictBase32Decode('mzxw6ytboi======').toString('utf8'), 'foobar');
});

test('strictBase32Decode rejects bad alphabet, length, padding, and tail bits', async () => {
  const { strictBase32Decode } = await import('../../scripts/lib/totp.mjs');
  assert.equal(strictBase32Decode('MZXW6YTB0I======'), null); // '0' not in alphabet
  assert.equal(strictBase32Decode('MZXW6YTBOI====='), null); // 5 pads illegal
  assert.equal(strictBase32Decode('MZXW6=YTBOI====='), null); // pad mid-string
  // Unpadded remainder 2 is legal ('foobar' minus padding decodes):
  assert.equal(strictBase32Decode('MZXW6YTBOI').toString('utf8'), 'foobar');
  assert.equal(strictBase32Decode('A'), null); // remainder 1 never legal
  // 'J' (01001) leaves nonzero unused low bits where canonical 'I' (01000)
  // leaves zeros: non-canonical encodings are rejected.
  assert.equal(strictBase32Decode('MZXW6YTBOJ======'), null);
  assert.equal(strictBase32Decode(''), null);
  assert.equal(strictBase32Decode(null), null);
});

test('guaranteedWrongCode differs from previous, current, and next window codes', async () => {
  const { guaranteedWrongCode, totpWindowCodes } = await import('../../scripts/lib/totp.mjs');
  const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  // Walk many windows to exercise varied code values.
  for (let window = 0; window < 200; window++) {
    const atMs = (59 + window * 30) * 1000;
    const accepted = new Set(totpWindowCodes(secret, atMs));
    const wrong = guaranteedWrongCode(secret, atMs);
    assert.match(wrong, /^\d{6}$/);
    assert.ok(!accepted.has(wrong), `window ${window}: ${wrong} collided`);
  }
});
