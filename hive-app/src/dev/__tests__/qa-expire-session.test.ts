import { SessionStorageAdapter, type SecureStoreBackend } from '@/auth/secure-store-adapter';
import {
  QA_EXPIRED_REFRESH_TOKEN,
  QA_EXPIRE_HOOK_MARKER,
  QA_EXPIRE_QUIESCE_MS,
  expireSessionEnvelope,
  expireStoredSessionForQa,
  isQaExpireUrl,
} from '../qa-expire-session';

class MemoryBackend implements SecureStoreBackend {
  store = new Map<string, string>();
  async getItem(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }
  async setItem(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }
  async deleteItem(key: string): Promise<void> {
    this.store.delete(key);
  }
}

/** A minimal Supabase session envelope with a future expiry. */
function futureSession(): string {
  return JSON.stringify({
    access_token: 'header.body.sig',
    refresh_token: 'refresh-token',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: '00000000-0000-0000-0000-000000000001' },
  });
}

describe('dev-only QA session-expiry hook', () => {
  it('recognizes exactly the QA deep link — no substrings', () => {
    expect(isQaExpireUrl('hivedev:///?qa=expire-session')).toBe(true);
    expect(isQaExpireUrl('hivedev://?qa=expire-session')).toBe(true);
    // Substring / foreign-scheme / host / path / value / extra-param attacks
    // all fail — this hook rewrites persisted session state (RETURN-3 area 8).
    expect(isQaExpireUrl('https://evil.example/?qa=expire-session')).toBe(false);
    expect(isQaExpireUrl('hivedev://evil/?qa=expire-session')).toBe(false);
    expect(isQaExpireUrl('hivedev:///?qa=expire-session-extra')).toBe(false);
    expect(isQaExpireUrl('hivedev:///nested?qa=expire-session')).toBe(false);
    expect(isQaExpireUrl('hivedev:///?qa=expire-session&x=1')).toBe(false);
    expect(isQaExpireUrl('hivedev:///?qa=')).toBe(false);
    expect(isQaExpireUrl('hivedev:///')).toBe(false);
    expect(isQaExpireUrl('not a url at all')).toBe(false);
    expect(isQaExpireUrl('')).toBe(false);
  });

  it('quiesces the running app BEFORE touching storage (find 39)', async () => {
    const backend = new MemoryBackend();
    await new SessionStorageAdapter(backend).write(futureSession());
    const order: string[] = [];
    const spy: SecureStoreBackend = {
      getItem: async (key) => {
        order.push('read');
        return backend.getItem(key);
      },
      setItem: async (key, value) => {
        order.push('write');
        return backend.setItem(key, value);
      },
      deleteItem: (key) => backend.deleteItem(key),
    };
    const ok = await expireStoredSessionForQa(spy, async () => {
      order.push('quiesce');
    });
    expect(ok).toBe(true);
    expect(order[0]).toBe('quiesce');
    expect(order.filter((step) => step === 'quiesce')).toHaveLength(1);
    expect(QA_EXPIRE_QUIESCE_MS).toBeGreaterThan(0);
  });

  it('does NOT collide with the corruption hook link', () => {
    expect(isQaExpireUrl('hivedev:///?qa=corrupt-storage')).toBe(false);
  });

  it('makes a valid stored session read back as expired, still verifiable', async () => {
    const backend = new MemoryBackend();
    const adapter = new SessionStorageAdapter(backend);
    await adapter.write(futureSession());

    const ok = await expireStoredSessionForQa(backend);
    expect(ok).toBe(true);

    // The next read SUCCEEDS (not quarantine) — the digest was recomputed —
    // and the session is now expired in the past.
    const readBack = await adapter.read();
    expect(readBack).not.toBeNull();
    const parsed = JSON.parse(readBack as string);
    expect(parsed.expires_at * 1000).toBeLessThan(Date.now());
    expect(parsed.expires_in).toBe(0);
    // The refresh token is replaced by an inert value so the boot refresh is
    // definitively REJECTED (a valid one would silently resurrect the
    // session — 2026-09-06 review); everything else is preserved.
    expect(parsed.refresh_token).toBe(QA_EXPIRED_REFRESH_TOKEN);
    expect(parsed.refresh_token).not.toBe('refresh-token');
    expect(parsed.access_token).toBe('header.body.sig');
    expect(parsed.user.id).toBe('00000000-0000-0000-0000-000000000001');
  });

  it('is a no-op that reports false when there is no stored session', async () => {
    const backend = new MemoryBackend();
    expect(await expireStoredSessionForQa(backend)).toBe(false);
  });

  it('never fabricates a session over corrupt/non-session storage', async () => {
    // A raw non-JSON value is not a session envelope: the transform refuses
    // it rather than inventing one, so the flow fails loudly instead.
    expect(expireSessionEnvelope('not json')).toBeNull();
    expect(expireSessionEnvelope('42')).toBeNull();
    expect(expireSessionEnvelope('{"unrelated":"object"}')).toBeNull();
  });

  it('preserves an envelope that carries only expires_at', () => {
    const out = expireSessionEnvelope('{"expires_at":9999999999,"keep":"me"}');
    expect(out).not.toBeNull();
    const parsed = JSON.parse(out as string);
    expect(parsed.expires_at * 1000).toBeLessThan(Date.now());
    expect(parsed.keep).toBe('me');
  });

  it('carries the provable marker for bundle:inspect', () => {
    expect(QA_EXPIRE_HOOK_MARKER).toBe('HIVE_QA_EXPIRE_HOOK');
  });
});
