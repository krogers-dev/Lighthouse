/** Find 46 (2026-09-07 desktop run), through the REAL auth library.
 *
 * The library's own readers — the recovery read at construction, the
 * initial-session emitter behind onAuthStateChange, the refresh tick —
 * cannot be taught to catch the adapter's QuarantineRequiredError, and on
 * the device they turned it into "Auto refresh tick failed" lines and
 * unhandled rejections. These tests hold the bridge's answer in place
 * against the pinned library: the library sees "no session" and logs
 * nothing, the controller-facing getSession() still raises the quarantine,
 * and the bundle tells the controller exactly once. No network is involved:
 * a stored session an hour from expiry is never refreshed, and no call
 * here reaches a server.
 */
import type { SessionStorage } from '@/auth/controller';
import { QuarantineRequiredError } from '@/auth/secure-store-adapter';
import { base64UrlEncodeAscii } from '@/core/base64';
import type { EnvironmentConfig } from '@/core/env';

import { createSupabaseBundle, type SessionWriteGate } from '../client';

const env: EnvironmentConfig = {
  supabaseUrl: 'https://synthetic.example.invalid',
  supabaseClientKey: 'sb_publishable_synthetic_key_0000000000',
  keyKind: 'publishable',
  variant: 'development',
};

const SYNTHETIC_USER_ID = '00000000-0000-4000-8000-000000000001';

/** A stored session envelope in the library's own shape, with a decodable
 * (unsigned, synthetic) access token. */
function storedSession(expiresAtSeconds: number): string {
  const header = base64UrlEncodeAscii(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64UrlEncodeAscii(
    JSON.stringify({
      sub: SYNTHETIC_USER_ID,
      aud: 'authenticated',
      role: 'authenticated',
      aal: 'aal1',
      exp: expiresAtSeconds,
    }),
  );
  return JSON.stringify({
    access_token: `${header}.${payload}.synthetic-signature`,
    refresh_token: 'synthetic-refresh-token',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: expiresAtSeconds,
    user: {
      id: SYNTHETIC_USER_ID,
      aud: 'authenticated',
      role: 'authenticated',
      email: 'client@example.invalid',
      app_metadata: {},
      user_metadata: {},
      created_at: '2026-01-01T00:00:00Z',
    },
  });
}

class ScriptedStorage implements SessionStorage {
  value: string | null = null;
  readError: QuarantineRequiredError | null = null;
  reads = 0;
  async read(): Promise<string | null> {
    this.reads += 1;
    if (this.readError) throw this.readError;
    return this.value;
  }
  async write(next: string): Promise<void> {
    this.value = next;
  }
  async delete(): Promise<void> {
    this.value = null;
  }
  async scrubAll(): Promise<void> {
    this.value = null;
  }
  async hasResidue(): Promise<boolean> {
    return this.value !== null;
  }
}

async function settleMicrotasks(): Promise<void> {
  for (let i = 0; i < 25; i += 1) {
    await Promise.resolve();
  }
}

describe('quarantine met by the auth library itself (find 46)', () => {
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
    jest.useRealTimers();
  });

  it('a corrupt store at construction: the library sees no session and logs nothing; getSession() still raises it; one notification', async () => {
    const storage = new ScriptedStorage();
    const failure = new QuarantineRequiredError('corrupt');
    storage.readError = failure;
    const gate: SessionWriteGate = { open: true };
    const seen: QuarantineRequiredError[] = [];
    const bundle = createSupabaseBundle(env, storage, gate, {
      onQuarantine: (error) => seen.push(error),
    });
    // The initial-session emitter behind the listener is a reader too.
    const unsubscribe = bundle.auth.onAuthStateChange(() => {});

    await expect(bundle.auth.getSession()).rejects.toBe(failure);

    // The library's own view of the store: no session, no error — nothing
    // that could be left as an unhandled rejection.
    const libraryView = await bundle.client.auth.getSession();
    expect(libraryView.data.session).toBeNull();
    expect(libraryView.error).toBeNull();
    await settleMicrotasks();

    expect(seen).toEqual([failure]);
    expect(gate.open).toBe(false);
    expect(storage.reads).toBe(1);
    expect(errorSpy).not.toHaveBeenCalled();
    unsubscribe();
    bundle.dispose();
  });

  it('the refresh tick meeting a fresh corruption: no logged failure, one notification, the adapter never read again', async () => {
    jest.useFakeTimers({
      doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate', 'clearImmediate'],
    });
    const storage = new ScriptedStorage();
    storage.value = storedSession(Math.floor(Date.now() / 1000) + 3600);
    const gate: SessionWriteGate = { open: true };
    const seen: QuarantineRequiredError[] = [];
    const bundle = createSupabaseBundle(env, storage, gate, {
      onQuarantine: (error) => seen.push(error),
    });

    // The library loads the stored session itself, healthy.
    const before = await bundle.client.auth.getSession();
    expect(before.data.session?.refresh_token).toBe('synthetic-refresh-token');
    bundle.auth.startAutoRefresh();
    await jest.advanceTimersByTimeAsync(0); // the immediate tick, still healthy
    const healthyReads = storage.reads;
    expect(healthyReads).toBeGreaterThan(0);

    const failure = new QuarantineRequiredError('corrupt');
    storage.readError = failure;
    await jest.advanceTimersByTimeAsync(30_000); // the next tick meets it

    expect(seen).toEqual([failure]);
    expect(gate.open).toBe(false);
    expect(errorSpy).not.toHaveBeenCalled();
    expect(storage.reads).toBe(healthyReads + 1);

    // The controller-facing path raises exactly what was absorbed…
    await expect(bundle.auth.getSession()).rejects.toBe(failure);
    // …and later ticks no longer touch the adapter.
    await jest.advanceTimersByTimeAsync(90_000);
    expect(storage.reads).toBe(healthyReads + 1);
    expect(errorSpy).not.toHaveBeenCalled();
    bundle.dispose();
  });
});
