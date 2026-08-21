import type { SessionStorage } from '@/auth/controller';

import { bridgeStorage, type SessionWriteGate } from '../client';

class RecordingStorage implements SessionStorage {
  value: string | null = null;
  writes = 0;
  deletes = 0;
  async read(): Promise<string | null> {
    return this.value;
  }
  async write(next: string): Promise<void> {
    this.writes += 1;
    this.value = next;
  }
  async delete(): Promise<void> {
    this.deletes += 1;
    this.value = null;
  }
  async scrubAll(): Promise<void> {
    this.value = null;
  }
  async hasResidue(): Promise<boolean> {
    return this.value !== null;
  }
}

const SESSION_KEY = 'hive-session';

describe('storage bridge write gate (review P2-3)', () => {
  it('passes session reads and writes through while open', async () => {
    const storage = new RecordingStorage();
    const gate: SessionWriteGate = { open: true };
    const bridge = bridgeStorage(storage, gate);
    await bridge.setItem(SESSION_KEY, 'synthetic-session');
    expect(await bridge.getItem(SESSION_KEY)).toBe('synthetic-session');
    expect(storage.writes).toBe(1);
  });

  it('drops late session writes and hides reads once closed', async () => {
    const storage = new RecordingStorage();
    const gate: SessionWriteGate = { open: true };
    const bridge = bridgeStorage(storage, gate);
    await bridge.setItem(SESSION_KEY, 'synthetic-session');
    gate.open = false;
    // A late library-internal refresh cannot re-persist after sign-out began…
    await bridge.setItem(SESSION_KEY, 'late-refresh-session');
    expect(storage.writes).toBe(1);
    expect(storage.value).toBe('synthetic-session');
    // …and cannot evaluate the retained session either.
    expect(await bridge.getItem(SESSION_KEY)).toBeNull();
  });

  it('always allows deletion, closed or open', async () => {
    const storage = new RecordingStorage();
    const gate: SessionWriteGate = { open: false };
    const bridge = bridgeStorage(storage, gate);
    storage.value = 'residue';
    await bridge.removeItem(SESSION_KEY);
    expect(storage.deletes).toBe(1);
    expect(storage.value).toBeNull();
  });

  it('keeps non-session keys in transient memory, unaffected by the gate', async () => {
    const storage = new RecordingStorage();
    const gate: SessionWriteGate = { open: false };
    const bridge = bridgeStorage(storage, gate);
    await bridge.setItem('code-verifier', 'transient');
    expect(await bridge.getItem('code-verifier')).toBe('transient');
    await bridge.removeItem('code-verifier');
    expect(await bridge.getItem('code-verifier')).toBeNull();
    expect(storage.writes).toBe(0);
  });
});
