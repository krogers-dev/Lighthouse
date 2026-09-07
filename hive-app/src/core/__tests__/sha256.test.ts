import { sha256Hex, utf8ByteLength, utf8Encode } from '../sha256';

describe('sha256', () => {
  // FIPS 180-4 test vectors.
  it('hashes the empty string', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('hashes "abc"', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('hashes the two-block NIST vector', () => {
    expect(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
  });

  it('hashes byte input identically to string input', () => {
    expect(sha256Hex(utf8Encode('abc'))).toBe(sha256Hex('abc'));
  });

  it('handles inputs crossing the padding boundary (55/56/64 bytes)', () => {
    for (const length of [55, 56, 63, 64, 65]) {
      const value = 'a'.repeat(length);
      expect(sha256Hex(value)).toMatch(/^[0-9a-f]{64}$/);
      expect(sha256Hex(value)).toBe(sha256Hex(utf8Encode(value)));
    }
  });
});

describe('utf8', () => {
  it('encodes multi-byte characters', () => {
    expect(Array.from(utf8Encode('é'))).toEqual([0xc3, 0xa9]);
    expect(Array.from(utf8Encode('€'))).toEqual([0xe2, 0x82, 0xac]);
    expect(Array.from(utf8Encode('𝄞'))).toEqual([0xf0, 0x9d, 0x84, 0x9e]);
  });

  it('reports byte length, not code-unit length', () => {
    expect(utf8ByteLength('é€𝄞')).toBe(2 + 3 + 4);
  });
});
