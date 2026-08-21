import { utf8ByteLength } from '@/core/sha256';
import {
  CHUNK_BYTE_LIMIT,
  LEGACY_SESSION_KEY,
  MANIFEST_KEY,
  MAX_CHUNKS,
  QuarantineRequiredError,
  SessionStorageAdapter,
  chunkKey,
  type SecureStoreBackend,
} from '../secure-store-adapter';

/** In-memory SecureStore fake with fault injection and the platform's
 * per-item size ceiling. */
class FakeBackend implements SecureStoreBackend {
  store = new Map<string, string>();
  log: string[] = [];
  failGetKeys = new Set<string>();
  failSetKeys = new Set<string>();
  failDeleteKeys = new Set<string>();
  /** When set, deletes are acknowledged but silently ignored (read-back catches it). */
  silentlyIgnoreDeletes = false;
  sizeLimit = 2048;
  setCountUntilFailure: number | null = null;

  async getItem(key: string): Promise<string | null> {
    this.log.push(`get:${key}`);
    if (this.failGetKeys.has(key)) throw new Error('errSecItemNotFound (simulated)');
    return this.store.get(key) ?? null;
  }

  async setItem(key: string, value: string): Promise<void> {
    this.log.push(`set:${key}`);
    if (this.failSetKeys.has(key)) throw new Error('keystore write rejected (simulated)');
    if (this.setCountUntilFailure !== null) {
      if (this.setCountUntilFailure <= 0) throw new Error('keystore write rejected (simulated)');
      this.setCountUntilFailure -= 1;
    }
    if (utf8ByteLength(value) > this.sizeLimit) {
      throw new Error(`value exceeds ${this.sizeLimit} bytes (simulated platform limit)`);
    }
    this.store.set(key, value);
  }

  async deleteItem(key: string): Promise<void> {
    this.log.push(`del:${key}`);
    if (this.failDeleteKeys.has(key)) throw new Error('keystore delete rejected (simulated)');
    if (!this.silentlyIgnoreDeletes) this.store.delete(key);
  }
}

function makeAdapter(backend: FakeBackend = new FakeBackend()) {
  return { backend, adapter: new SessionStorageAdapter(backend) };
}

const SMALL_SESSION = JSON.stringify({ access_token: 'synthetic.small', user: 'synthetic' });
// Guaranteed to span multiple chunks.
const BIG_SESSION = JSON.stringify({
  access_token: 'a'.repeat(3000),
  refresh_token: 'b'.repeat(2500),
  note: 'synthetic oversized session é€𝄞',
});

describe('normal round trips', () => {
  it('stores and reads back a small session', async () => {
    const { adapter } = makeAdapter();
    await adapter.write(SMALL_SESSION);
    expect(await adapter.read()).toBe(SMALL_SESSION);
  });

  it('reads null when nothing was ever stored', async () => {
    const { adapter } = makeAdapter();
    expect(await adapter.read()).toBeNull();
  });

  it('chunks oversized sessions under the platform byte limit and reassembles them', async () => {
    const { backend, adapter } = makeAdapter();
    await adapter.write(BIG_SESSION);
    expect(await adapter.read()).toBe(BIG_SESSION);
    const chunkEntries = [...backend.store.keys()].filter((k) => k !== MANIFEST_KEY);
    expect(chunkEntries.length).toBeGreaterThan(1);
    for (const key of chunkEntries) {
      expect(utf8ByteLength(backend.store.get(key) as string)).toBeLessThanOrEqual(
        CHUNK_BYTE_LIMIT,
      );
    }
  });

  it('cleans the prior generation only after commit, alternating slots', async () => {
    const { backend, adapter } = makeAdapter();
    await adapter.write(BIG_SESSION);
    const firstKeys = [...backend.store.keys()].filter((k) => k !== MANIFEST_KEY);
    await adapter.write(SMALL_SESSION);
    const secondKeys = [...backend.store.keys()].filter((k) => k !== MANIFEST_KEY);
    // Old slot fully cleaned; new slot in use.
    expect(secondKeys.some((k) => firstKeys.includes(k))).toBe(false);
    expect(await adapter.read()).toBe(SMALL_SESSION);
  });

  it('rejects a value beyond the bounded chunk budget without quarantining', async () => {
    const { adapter } = makeAdapter();
    const enormous = 'x'.repeat(CHUNK_BYTE_LIMIT * MAX_CHUNKS + 1);
    await expect(adapter.write(enormous)).rejects.toThrow(/too large/i);
    await expect(adapter.read()).resolves.toBeNull();
  });
});

describe('two-phase commit', () => {
  it('retains the prior complete generation when the new manifest cannot publish', async () => {
    const { backend, adapter } = makeAdapter();
    await adapter.write(SMALL_SESSION);
    backend.failSetKeys.add(MANIFEST_KEY);
    await expect(adapter.write(BIG_SESSION)).rejects.toThrow(QuarantineRequiredError);
    backend.failSetKeys.clear();
    expect(await adapter.read()).toBe(SMALL_SESSION);
  });

  it('retains the prior complete generation when chunk writes fail mid-way', async () => {
    const { backend, adapter } = makeAdapter();
    await adapter.write(BIG_SESSION);
    backend.setCountUntilFailure = 1; // fail on the second chunk write
    await expect(adapter.write(SMALL_SESSION + BIG_SESSION)).rejects.toThrow(
      QuarantineRequiredError,
    );
    backend.setCountUntilFailure = null;
    expect(await adapter.read()).toBe(BIG_SESSION);
  });

  it('treats uncommitted chunks without a manifest as no session (crash before commit)', async () => {
    const backend = new FakeBackend();
    backend.store.set(chunkKey(0, 0), 'orphaned-partial-write');
    const adapter = new SessionStorageAdapter(backend);
    expect(await adapter.read()).toBeNull();
    expect(await adapter.hasResidue()).toBe(true);
  });
});

describe('quarantine paths', () => {
  it('quarantines on corrupt digest (tampered chunk)', async () => {
    const { backend, adapter } = makeAdapter();
    await adapter.write(BIG_SESSION);
    const someChunk = [...backend.store.keys()].find((k) => k !== MANIFEST_KEY) as string;
    backend.store.set(someChunk, 'tampered');
    await expect(adapter.read()).rejects.toThrow(QuarantineRequiredError);
  });

  it('quarantines on a missing chunk', async () => {
    const { backend, adapter } = makeAdapter();
    await adapter.write(BIG_SESSION);
    const chunkKeys = [...backend.store.keys()].filter((k) => k !== MANIFEST_KEY);
    backend.store.delete(chunkKeys[chunkKeys.length - 1] as string);
    await expect(adapter.read()).rejects.toThrow(QuarantineRequiredError);
  });

  it('quarantines on a corrupt manifest', async () => {
    const { backend, adapter } = makeAdapter();
    await adapter.write(SMALL_SESSION);
    backend.store.set(MANIFEST_KEY, '{not json');
    await expect(adapter.read()).rejects.toThrow(QuarantineRequiredError);
  });

  it('quarantines on an unsupported (old) manifest version', async () => {
    const { backend, adapter } = makeAdapter();
    backend.store.set(
      MANIFEST_KEY,
      JSON.stringify({ v: 0, generation: 1, slot: 0, chunkCount: 1, byteCount: 4, digest: '00' }),
    );
    await expect(adapter.read()).rejects.toThrow(QuarantineRequiredError);
  });

  it('quarantines on legacy single-key data (old format never evaluated)', async () => {
    const backend = new FakeBackend();
    backend.store.set(LEGACY_SESSION_KEY, 'legacy-format-session');
    const adapter = new SessionStorageAdapter(backend);
    await expect(adapter.read()).rejects.toThrow(QuarantineRequiredError);
  });

  it('quarantines on read rejection (biometric invalidation / keystore error)', async () => {
    const { backend, adapter } = makeAdapter();
    await adapter.write(SMALL_SESSION);
    backend.failGetKeys.add(MANIFEST_KEY);
    await expect(adapter.read()).rejects.toThrow(QuarantineRequiredError);
  });

  it('quarantines on write rejection', async () => {
    const { backend, adapter } = makeAdapter();
    backend.setCountUntilFailure = 0;
    await expect(adapter.write(SMALL_SESSION)).rejects.toThrow(QuarantineRequiredError);
  });

  it('quarantines on deletion rejection', async () => {
    const { backend, adapter } = makeAdapter();
    await adapter.write(SMALL_SESSION);
    backend.failDeleteKeys.add(MANIFEST_KEY);
    await expect(adapter.delete()).rejects.toThrow(QuarantineRequiredError);
  });

  it('quarantines on read-back mismatch after delete (silent keystore no-op)', async () => {
    const { backend, adapter } = makeAdapter();
    await adapter.write(SMALL_SESSION);
    backend.silentlyIgnoreDeletes = true;
    await expect(adapter.delete()).rejects.toThrow(QuarantineRequiredError);
  });
});

describe('delete and scrub', () => {
  it('delete removes everything and verifies absence', async () => {
    const { backend, adapter } = makeAdapter();
    await adapter.write(BIG_SESSION);
    await adapter.delete();
    expect(backend.store.size).toBe(0);
    expect(await adapter.read()).toBeNull();
    expect(await adapter.hasResidue()).toBe(false);
  });

  it('scrubAll clears orphans, legacy data, and both slots', async () => {
    const backend = new FakeBackend();
    backend.store.set(LEGACY_SESSION_KEY, 'legacy');
    backend.store.set(chunkKey(0, 3), 'orphan-a');
    backend.store.set(chunkKey(1, 7), 'orphan-b');
    backend.store.set(MANIFEST_KEY, '{not json');
    const adapter = new SessionStorageAdapter(backend);
    await adapter.scrubAll();
    expect(backend.store.size).toBe(0);
    expect(await adapter.hasResidue()).toBe(false);
  });

  it('scrubAll fails loudly when the keystore will not delete', async () => {
    const backend = new FakeBackend();
    backend.store.set(chunkKey(0, 0), 'stuck');
    backend.failDeleteKeys.add(chunkKey(0, 0));
    const adapter = new SessionStorageAdapter(backend);
    await expect(adapter.scrubAll()).rejects.toThrow(QuarantineRequiredError);
  });
});

describe('reinstall residue detection', () => {
  it('reports residue for manifest, legacy, or slot-zero chunks', async () => {
    for (const key of [MANIFEST_KEY, LEGACY_SESSION_KEY, chunkKey(0, 0), chunkKey(1, 0)]) {
      const backend = new FakeBackend();
      backend.store.set(key, 'residue');
      const adapter = new SessionStorageAdapter(backend);
      expect(await adapter.hasResidue()).toBe(true);
    }
  });

  it('assumes residue when the keystore cannot be read (fail closed)', async () => {
    const backend = new FakeBackend();
    backend.failGetKeys.add(MANIFEST_KEY);
    const adapter = new SessionStorageAdapter(backend);
    expect(await adapter.hasResidue()).toBe(true);
  });
});

describe('operation serialization', () => {
  it('serializes reads, writes, and deletes in call order', async () => {
    const backend = new FakeBackend();
    const adapter = new SessionStorageAdapter(backend);
    const order: string[] = [];
    await Promise.all([
      adapter.write(SMALL_SESSION).then(() => order.push('write1')),
      adapter.read().then(() => order.push('read1')),
      adapter.write(BIG_SESSION).then(() => order.push('write2')),
      adapter.delete().then(() => order.push('delete')),
      adapter.read().then((v) => order.push(`read2:${v === null ? 'null' : 'value'}`)),
    ]);
    expect(order).toEqual(['write1', 'read1', 'write2', 'delete', 'read2:null']);
  });

  it('keeps the queue alive after a failed operation', async () => {
    const backend = new FakeBackend();
    const adapter = new SessionStorageAdapter(backend);
    backend.setCountUntilFailure = 0;
    await expect(adapter.write(SMALL_SESSION)).rejects.toThrow(QuarantineRequiredError);
    backend.setCountUntilFailure = null;
    await adapter.scrubAll();
    await adapter.write(SMALL_SESSION);
    expect(await adapter.read()).toBe(SMALL_SESSION);
  });
});

describe('interrupted scrub keeps residue detectable (review P2-4)', () => {
  it('a scrub that fails mid-sweep leaves at least one probe key', async () => {
    const { backend, adapter } = makeAdapter();
    await adapter.write(BIG_SESSION);
    // Fail on a non-probe chunk so the sweep dies before the probe keys.
    const someHighChunk = [...backend.store.keys()].find(
      (k) => k !== MANIFEST_KEY && !k.endsWith('.c0'),
    ) as string;
    backend.failDeleteKeys.add(someHighChunk);
    await expect(adapter.scrubAll()).rejects.toThrow(QuarantineRequiredError);
    // The manifest (a probe key) is deleted last, so residue stays visible.
    expect(await adapter.hasResidue()).toBe(true);
  });
});
