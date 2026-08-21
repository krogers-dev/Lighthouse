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
