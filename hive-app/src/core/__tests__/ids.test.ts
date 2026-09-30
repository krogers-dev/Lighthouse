import {
  InvalidIdError,
  asClientId,
  asEnvironmentId,
  isUuid,
  newOpaqueToken,
  newUuid,
} from '../ids';

describe('id validation', () => {
  it('accepts and lowercases valid UUIDs', () => {
    expect(asClientId('4C0FFEE0-1234-4ABC-8DEF-0123456789AB')).toBe(
      '4c0ffee0-1234-4abc-8def-0123456789ab',
    );
  });

  it('rejects malformed identifiers without echoing them', () => {
    const forged = 'DROP TABLE clients;--';
    try {
      asEnvironmentId(forged);
      throw new Error('expected rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidIdError);
      expect((error as Error).message).not.toContain(forged);
    }
  });

  it('validates uuid shape strictly', () => {
    expect(isUuid('4c0ffee0-1234-4abc-8def-0123456789ab')).toBe(true);
    expect(isUuid('4c0ffee0-1234-4abc-8def-0123456789a')).toBe(false);
    expect(isUuid('not-a-uuid')).toBe(false);
  });
});

describe('newOpaqueToken', () => {
  it('produces hex of the requested byte length', () => {
    const token = newOpaqueToken(16, {
      fill: (bytes) => bytes.fill(0xab),
    });
    expect(token).toBe('ab'.repeat(16));
  });

  // This passes under Node and the browser, where `globalThis.crypto`
  // exists. It is NOT evidence that the source works on device, and reading
  // it as such is how find 14 survived: Hermes ships no WebCrypto global,
  // so on device this same default threw. The case below pins that
  // behaviour so the limitation is stated rather than assumed.
  it('uses the platform secure random source by default', () => {
    const a = newOpaqueToken();
    const b = newOpaqueToken();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(a).not.toBe(b);
  });

  it('refuses rather than weakens when the runtime has no WebCrypto (Hermes)', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
    try {
      expect(() => newOpaqueToken()).toThrow('Secure random source unavailable');
    } finally {
      if (original) Object.defineProperty(globalThis, 'crypto', original);
      else delete (globalThis as { crypto?: unknown }).crypto;
    }
  });
});

describe('newUuid', () => {
  it('shapes 16 random bytes into a version-4, variant-1 UUID', () => {
    const fixed = { fill: (bytes: Uint8Array) => bytes.fill(0xff) };
    const uuid = newUuid(fixed);
    expect(uuid).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('differs per call with a real source, and is a valid identifier shape', () => {
    const a = newUuid();
    const b = newUuid();
    expect(a).not.toBe(b);
    expect(isUuid(a)).toBe(true);
  });
});
