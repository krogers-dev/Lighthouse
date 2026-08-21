import { InvalidIdError, asClientId, asEnvironmentId, isUuid, newOpaqueToken } from '../ids';

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

  it('uses the platform secure random source by default', () => {
    const a = newOpaqueToken();
    const b = newOpaqueToken();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(a).not.toBe(b);
  });
});
