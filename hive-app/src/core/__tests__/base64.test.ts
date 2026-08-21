import { base64UrlDecodeAscii, base64UrlEncodeAscii, jwtPayloadRole } from '../base64';

// Synthetic JWT segments assembled at runtime; never credentials.
function syntheticJwt(payload: object): string {
  const encode = (value: object) => base64UrlEncodeAscii(JSON.stringify(value));
  return `${encode({ alg: 'HS256' })}.${encode(payload)}.${'sig'.repeat(4)}`;
}

describe('base64UrlDecodeAscii', () => {
  it('decodes standard and url-safe alphabets with and without padding', () => {
    expect(base64UrlDecodeAscii('aGVsbG8=')).toBe('hello');
    expect(base64UrlDecodeAscii('aGVsbG8')).toBe('hello');
    expect(base64UrlDecodeAscii(base64UrlEncodeAscii('a+b/c?'))).toBe('a+b/c?');
    expect(base64UrlDecodeAscii(base64UrlEncodeAscii('hello'))).toBe('hello');
  });

  it('returns null on non-base64 input', () => {
    expect(base64UrlDecodeAscii('not base64 !!')).toBeNull();
  });
});

describe('jwtPayloadRole', () => {
  it('extracts the role claim', () => {
    expect(jwtPayloadRole(syntheticJwt({ role: 'anon' }))).toBe('anon');
    expect(jwtPayloadRole(syntheticJwt({ role: 'service_role' }))).toBe('service_role');
  });

  it('returns null for malformed tokens or missing roles', () => {
    expect(jwtPayloadRole('only.two')).toBeNull();
    expect(jwtPayloadRole(syntheticJwt({ sub: 'x' }))).toBeNull();
    expect(jwtPayloadRole('eyJa.eyJb.c')).toBeNull();
  });
});
