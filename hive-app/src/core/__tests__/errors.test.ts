import { SafeError, toSafeError, userMessageFor } from '../errors';

describe('toSafeError', () => {
  it('passes SafeError through unchanged', () => {
    const original = new SafeError('denied');
    expect(toSafeError(original)).toBe(original);
  });

  it('classifies fetch transport failures as network', () => {
    expect(toSafeError(new TypeError('Network request failed')).code).toBe('network');
  });

  it('maps everything else to unknown without leaking internals', () => {
    const internal = new Error(
      'connection to db-internal-host-1.local failed: password for role synthetic rejected',
    );
    const safe = toSafeError(internal);
    expect(safe.code).toBe('unknown');
    expect(safe.userMessage).not.toContain('db-internal-host-1');
    expect(safe.userMessage).not.toContain('password');
    expect(safe.message).not.toContain('db-internal-host-1');
  });

  it('maps thrown non-errors safely', () => {
    expect(toSafeError('boom').code).toBe('unknown');
    expect(toSafeError(undefined).code).toBe('unknown');
  });
});

describe('user messages', () => {
  it('offers calm, action-oriented copy for every code', () => {
    for (const code of [
      'network',
      'offline',
      'auth_invalid',
      'auth_expired',
      'denied',
      'stale_scope',
      'storage',
      'quarantine',
      'config',
      'conflict',
      'unknown',
    ] as const) {
      const message = userMessageFor(code);
      expect(message.length).toBeGreaterThan(10);
      expect(message).not.toMatch(/exception|stack|internal|null|undefined/i);
    }
  });
});
