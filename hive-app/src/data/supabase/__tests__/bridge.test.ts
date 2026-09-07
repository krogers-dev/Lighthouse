import type { SessionStorage } from '@/auth/controller';
import { QuarantineRequiredError } from '@/auth/secure-store-adapter';

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

/** Find 46 (2026-09-07 desktop run): during the quarantine transition the
 * auth library's OWN readers — the refresh tick, the initial-session
 * emitter, the token lookup inside a data call — met the adapter's
 * QuarantineRequiredError and turned it into logged "Auto refresh tick
 * failed" lines and unhandled rejections. Those readers cannot be taught
 * to catch it; the bridge can. It absorbs the first quarantine, closes the
 * gate, tells the controller once, and hands the library "no session".
 * The controller-facing path re-raises the absorbed error, so every
 * existing quarantine catch site still fires. */
class FailingStorage extends RecordingStorage {
  readError: Error | null = null;
  writeError: Error | null = null;
  deleteError: Error | null = null;
  reads = 0;
  override async read(): Promise<string | null> {
    this.reads += 1;
    if (this.readError) throw this.readError;
    return super.read();
  }
  override async write(next: string): Promise<void> {
    if (this.writeError) throw this.writeError;
    return super.write(next);
  }
  override async delete(): Promise<void> {
    if (this.deleteError) throw this.deleteError;
    return super.delete();
  }
}

describe('quarantine met by a library-internal reader (find 46)', () => {
  it('absorbs the first quarantine from a read: null to the caller, gate closed, one notification', async () => {
    const storage = new FailingStorage();
    const failure = new QuarantineRequiredError('corrupt');
    storage.readError = failure;
    const gate: SessionWriteGate = { open: true };
    const seen: QuarantineRequiredError[] = [];
    const bridge = bridgeStorage(storage, gate, { onQuarantine: (error) => seen.push(error) });
    await expect(bridge.getItem(SESSION_KEY)).resolves.toBeNull();
    expect(gate.open).toBe(false);
    expect(seen).toEqual([failure]);
    expect(bridge.quarantine()).toBe(failure);
  });

  it('after that, reads and writes never reach the adapter again and nothing is notified twice', async () => {
    const storage = new FailingStorage();
    storage.readError = new QuarantineRequiredError('partial');
    const gate: SessionWriteGate = { open: true };
    const seen: QuarantineRequiredError[] = [];
    const bridge = bridgeStorage(storage, gate, { onQuarantine: (error) => seen.push(error) });
    await bridge.getItem(SESSION_KEY);
    await bridge.getItem(SESSION_KEY);
    await bridge.setItem(SESSION_KEY, 'late-refresh-session');
    expect(storage.reads).toBe(1);
    expect(storage.writes).toBe(0);
    expect(seen).toHaveLength(1);
  });

  it('re-raises the absorbed error on the controller-facing path, and stays silent while clean', async () => {
    const storage = new FailingStorage();
    const gate: SessionWriteGate = { open: true };
    const bridge = bridgeStorage(storage, gate);
    expect(() => bridge.throwIfQuarantined()).not.toThrow();
    const failure = new QuarantineRequiredError('read_rejected');
    storage.readError = failure;
    await bridge.getItem(SESSION_KEY);
    expect(() => bridge.throwIfQuarantined()).toThrow(failure);
  });

  it('absorbs a quarantine raised by a write the same way', async () => {
    const storage = new FailingStorage();
    const failure = new QuarantineRequiredError('write_unverified');
    storage.writeError = failure;
    const gate: SessionWriteGate = { open: true };
    const seen: QuarantineRequiredError[] = [];
    const bridge = bridgeStorage(storage, gate, { onQuarantine: (error) => seen.push(error) });
    await expect(bridge.setItem(SESSION_KEY, 'refreshed-session')).resolves.toBeUndefined();
    expect(gate.open).toBe(false);
    expect(seen).toEqual([failure]);
    expect(bridge.quarantine()).toBe(failure);
  });

  it('leaves every other adapter error alone: it still rejects, and nothing is recorded', async () => {
    const storage = new FailingStorage();
    storage.writeError = new Error('Session value too large: 65 chunks exceeds 64');
    const gate: SessionWriteGate = { open: true };
    const seen: QuarantineRequiredError[] = [];
    const bridge = bridgeStorage(storage, gate, { onQuarantine: (error) => seen.push(error) });
    await expect(bridge.setItem(SESSION_KEY, 'oversized')).rejects.toThrow(/too large/);
    expect(gate.open).toBe(true);
    expect(seen).toHaveLength(0);
    expect(bridge.quarantine()).toBeNull();
  });

  it("passes a deletion failure through unchanged: the controller's own verified delete is the authority", async () => {
    const storage = new FailingStorage();
    const failure = new QuarantineRequiredError('delete_failed');
    storage.deleteError = failure;
    const gate: SessionWriteGate = { open: false };
    const seen: QuarantineRequiredError[] = [];
    const bridge = bridgeStorage(storage, gate, { onQuarantine: (error) => seen.push(error) });
    await expect(bridge.removeItem(SESSION_KEY)).rejects.toBe(failure);
    expect(seen).toHaveLength(0);
    expect(bridge.quarantine()).toBeNull();
  });
});
