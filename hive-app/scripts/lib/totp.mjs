/** RFC 4648 base32 decoding and RFC 6238 TOTP (SHA-1, 30s step, 6 digits),
 * used by the black-box auth prover to act as a real authenticator app.
 * Pure and unit-tested against the RFC test vectors. */
import { createHmac } from 'node:crypto';

export function base32Decode(input) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  const out = [];
  for (const char of input.replace(/=+$/, '').toUpperCase()) {
    const index = alphabet.indexOf(char);
    if (index === -1) continue;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((value >> bits) & 0xff);
    }
  }
  return Buffer.from(out);
}

/** Strict canonical RFC 4648 Base32 (RETURN-3 area 8): rejects — rather
 * than skipping — any character outside A-Z2-7, wrong total length (must
 * be a multiple of 8 with padding), padding in illegal positions or
 * amounts (only 0, 1, 3, 4, or 6 '=' at the very end), and non-zero
 * unused tail bits (non-canonical encodings). Returns the decoded bytes
 * or null. */
export function strictBase32Decode(input) {
  if (typeof input !== 'string' || input.length === 0) return null;
  // ASCII validation BEFORE any case folding (RETURN-4 P2-2): Unicode
  // characters like dotless i (U+0131) case-fold into valid ASCII 'I',
  // which would launder a non-alphabet input into acceptance.
  if (!/^[A-Za-z2-7=]+$/.test(input)) return null;
  const normalized = input.toUpperCase();
  if (!/^[A-Z2-7]+={0,6}$/.test(normalized)) return null;
  const padIndex = normalized.indexOf('=');
  const body = padIndex === -1 ? normalized : normalized.slice(0, padIndex);
  const padding = padIndex === -1 ? 0 : normalized.length - padIndex;
  if (![0, 1, 3, 4, 6].includes(padding)) return null;
  if (padding > 0 && (body.length + padding) % 8 !== 0) return null;
  const remainder = body.length % 8;
  // Legal unpadded remainders and the padding each implies.
  const paddingForRemainder = { 0: 0, 2: 6, 4: 4, 5: 3, 7: 1 };
  if (!(remainder in paddingForRemainder)) return null;
  if (padding > 0 && padding !== paddingForRemainder[remainder]) return null;
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  const out = [];
  for (const char of body) {
    value = (value << 5) | alphabet.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((value >> bits) & 0xff);
    }
  }
  // Canonical encodings zero every unused tail bit.
  if (bits > 0 && (value & ((1 << bits) - 1)) !== 0) return null;
  return Buffer.from(out);
}

/** Codes for every window a tolerant server could accept for a
 * submission between `atMs` and `atMs + graceSeconds` (RETURN-4 P2-3):
 * one window before the generation window through one window after the
 * latest window reachable within the grace interval. At a 30s rollover,
 * the naive previous/current/next triple missed the server's NEW
 * adjacent window. */
export function totpWindowCodes(
  secretBase32,
  atMs = Date.now(),
  stepSeconds = 30,
  graceSeconds = 90,
) {
  const firstWindow = Math.max(0, Math.floor(atMs / 1000 / stepSeconds) - 1);
  const lastWindow = Math.floor((atMs / 1000 + graceSeconds) / stepSeconds) + 1;
  const codes = [];
  for (let window = firstWindow; window <= lastWindow; window++) {
    codes.push(totpCode(secretBase32, window * stepSeconds * 1000, stepSeconds));
  }
  return codes;
}

/** A six-digit code guaranteed wrong for any submission within
 * `graceSeconds` of generation, under adjacent-window tolerance: it
 * differs from every code in that reachable span. Callers must submit
 * before `expiresAtMs` (returned alongside by the helper) or regenerate. */
export function guaranteedWrongCode(
  secretBase32,
  atMs = Date.now(),
  stepSeconds = 30,
  graceSeconds = 90,
) {
  const accepted = new Set(totpWindowCodes(secretBase32, atMs, stepSeconds, graceSeconds));
  let candidate = (Number(totpCode(secretBase32, atMs, stepSeconds)) + 1) % 1_000_000;
  while (accepted.has(String(candidate).padStart(6, '0'))) {
    candidate = (candidate + 1) % 1_000_000;
  }
  return String(candidate).padStart(6, '0');
}

export function totpCode(secretBase32, atMs = Date.now(), stepSeconds = 30, digits = 6) {
  const counter = Math.floor(atMs / 1000 / stepSeconds);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', base32Decode(secretBase32)).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const code = (digest.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits;
  return String(code).padStart(digits, '0');
}
