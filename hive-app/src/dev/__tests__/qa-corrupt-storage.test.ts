import {
  MANIFEST_KEY,
  QuarantineRequiredError,
  SessionStorageAdapter,
  type SecureStoreBackend,
} from '@/auth/secure-store-adapter';
import {
  QA_CORRUPT_HOOK_MARKER,
  corruptStoredSessionForQa,
  isQaCorruptUrl,
} from '../qa-corrupt-storage';

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

describe('dev-only QA storage-corruption hook', () => {
  it('recognizes exactly the QA deep link — no substrings', () => {
    // The link moved from a PATH to a root QUERY because Expo Router
    // claimed the path as a route and rendered Unmatched Route before this
    // hook could run (find 24). Exactness did not move with it.
    expect(isQaCorruptUrl('hivedev:///?qa=corrupt-storage')).toBe(true);
    expect(isQaCorruptUrl('hivedev://dashboard')).toBe(false);
    // Substring attacks must never trigger the hook (RETURN-3 area 8).
    expect(isQaCorruptUrl('https://evil.example/?qa=corrupt-storage')).toBe(false);
    expect(isQaCorruptUrl('hivedev:///?qa=corrupt-storage-extra')).toBe(false);
    expect(isQaCorruptUrl('hivedev:///nested?qa=corrupt-storage')).toBe(false);
    expect(isQaCorruptUrl('hivedev://other/?qa=corrupt-storage')).toBe(false);
    // An extra parameter is no longer tolerated: the old contract accepted
    // '?x=1' alongside the trigger, which widened the surface for nothing.
    expect(isQaCorruptUrl('hivedev:///?qa=corrupt-storage&x=1')).toBe(false);
    expect(isQaCorruptUrl('not a url at all')).toBe(false);
  });

  it('makes a previously valid stored session quarantine on the next read', async () => {
    const backend = new MemoryBackend();
    const adapter = new SessionStorageAdapter(backend);
    await adapter.write('{"synthetic":"session"}');
    await expect(adapter.read()).resolves.toBe('{"synthetic":"session"}');

    await corruptStoredSessionForQa(backend);
    await expect(adapter.read()).rejects.toBeInstanceOf(QuarantineRequiredError);
  });

  it('touches only the manifest key and embeds the provable marker', async () => {
    const backend = new MemoryBackend();
    const adapter = new SessionStorageAdapter(backend);
    await adapter.write('{"synthetic":"session"}');
    const keysBefore = new Set(backend.store.keys());
    await corruptStoredSessionForQa(backend);
    expect(new Set(backend.store.keys())).toEqual(keysBefore);
    expect(backend.store.get(MANIFEST_KEY)).toContain(QA_CORRUPT_HOOK_MARKER);
  });
});

describe('the QA deep link Expo Router does not swallow (find 24)', () => {
  // hivedev://qa/corrupt-storage was claimed by EXPO ROUTER as the route
  // /qa/corrupt-storage, which does not exist: the router rendered its
  // "Unmatched Route" screen and the app's own Linking listener never got
  // to run the corruption. Proven on device. The link now addresses the
  // ROOT with a query, which resolves to a route that does exist, so the
  // router navigates normally and the listener still sees the whole URL.
  it('accepts the root-with-query form', () => {
    expect(isQaCorruptUrl('hivedev:///?qa=corrupt-storage')).toBe(true);
    expect(isQaCorruptUrl('hivedev://?qa=corrupt-storage')).toBe(true);
  });

  it('REFUSES the old path form, which the router steals', () => {
    expect(isQaCorruptUrl('hivedev://qa/corrupt-storage')).toBe(false);
  });

  // Exactness is the whole point: this hook corrupts stored session state.
  it('REFUSES a foreign scheme, a host, or a different value', () => {
    expect(isQaCorruptUrl('https://evil.example/?qa=corrupt-storage')).toBe(false);
    expect(isQaCorruptUrl('hivedev://evil/?qa=corrupt-storage')).toBe(false);
    expect(isQaCorruptUrl('hivedev:///?qa=corrupt-storage-extra')).toBe(false);
    expect(isQaCorruptUrl('hivedev:///?qa=')).toBe(false);
    expect(isQaCorruptUrl('hivedev:///')).toBe(false);
  });

  it('REFUSES a path, and refuses extra parameters riding along', () => {
    expect(isQaCorruptUrl('hivedev:///dashboard?qa=corrupt-storage')).toBe(false);
    expect(isQaCorruptUrl('hivedev:///?qa=corrupt-storage&and=more')).toBe(false);
  });

  it('REFUSES malformed input without throwing', () => {
    expect(isQaCorruptUrl('not a url')).toBe(false);
    expect(isQaCorruptUrl('')).toBe(false);
  });
});
