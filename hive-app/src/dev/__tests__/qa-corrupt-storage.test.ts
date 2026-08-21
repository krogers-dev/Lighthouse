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
  it('recognizes exactly the QA deep-link path', () => {
    expect(isQaCorruptUrl('hivedev://qa/corrupt-storage')).toBe(true);
    expect(isQaCorruptUrl('hivedev://dashboard')).toBe(false);
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
