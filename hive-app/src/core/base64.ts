/** Minimal base64/base64url decoding to ASCII, dependency-free so it runs
 * identically under Hermes, Node, and web. Used to inspect JWT payloads
 * during configuration validation (never for cryptography). */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function base64UrlEncodeAscii(input: string): string {
  let out = '';
  for (let i = 0; i < input.length; i += 3) {
    const a = input.charCodeAt(i);
    const b = i + 1 < input.length ? input.charCodeAt(i + 1) : null;
    const c = i + 2 < input.length ? input.charCodeAt(i + 2) : null;
    out += ALPHABET[a >> 2];
    out += ALPHABET[((a & 0x03) << 4) | ((b ?? 0) >> 4)];
    if (b !== null) out += ALPHABET[((b & 0x0f) << 2) | ((c ?? 0) >> 6)];
    if (c !== null) out += ALPHABET[c & 0x3f];
  }
  return out.replace(/\+/g, '-').replace(/\//g, '_');
}

export function base64UrlDecodeAscii(input: string): string | null {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  let bits = 0;
  let value = 0;
  let out = '';
  for (const char of normalized) {
    const index = ALPHABET.indexOf(char);
    if (index === -1) return null;
    value = (value << 6) | index;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out += String.fromCharCode((value >> bits) & 0xff);
    }
  }
  return out;
}

/** The `role` claim of a JWT-shaped string, or null when it has none or
 * cannot be decoded. */
export function jwtPayloadRole(token: string): string | null {
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[1]) return null;
  const decoded = base64UrlDecodeAscii(parts[1]);
  if (decoded === null) return null;
  try {
    const payload = JSON.parse(decoded) as Record<string, unknown>;
    return typeof payload['role'] === 'string' ? payload['role'] : null;
  } catch {
    return null;
  }
}
