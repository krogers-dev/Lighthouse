import { InstallMarker } from '../install-marker';

class MemoryStore {
  content: string | null = null;
  failRead = false;
  async read(): Promise<string | null> {
    if (this.failRead) throw new Error('fs unavailable (simulated)');
    return this.content;
  }
  async write(content: string): Promise<void> {
    this.content = content;
  }
}

const fixedRandom = { fill: (b: Uint8Array) => b.fill(0x2a) };

describe('InstallMarker', () => {
  it('reports absent on a fresh install and ensures a marker', async () => {
    const store = new MemoryStore();
    const marker = new InstallMarker(store, fixedRandom, () => 42);
    expect(await marker.exists()).toBe(false);
    await marker.ensure();
    expect(await marker.exists()).toBe(true);
    const parsed = JSON.parse(store.content as string);
    expect(parsed).toEqual({ v: 1, installId: '2a'.repeat(16), createdAt: 42 });
  });

  it('is idempotent', async () => {
    const store = new MemoryStore();
    const marker = new InstallMarker(store, fixedRandom, () => 42);
    await marker.ensure();
    const first = store.content;
    await marker.ensure();
    expect(store.content).toBe(first);
  });

  it('treats malformed content as absent (fails closed into a scrub)', async () => {
    const store = new MemoryStore();
    store.content = '{broken';
    const marker = new InstallMarker(store, fixedRandom);
    expect(await marker.exists()).toBe(false);
    store.content = JSON.stringify({ v: 999 });
    expect(await marker.exists()).toBe(false);
  });

  it('treats unreadable storage as absent (fails closed into a scrub)', async () => {
    const store = new MemoryStore();
    store.failRead = true;
    const marker = new InstallMarker(store, fixedRandom);
    expect(await marker.exists()).toBe(false);
  });
});
