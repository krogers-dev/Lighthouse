/** Versioned secure session storage with generation-based two-phase commit.
 *
 * The platform keystore (expo-secure-store) limits item size, offers no key
 * enumeration, and can fail or return stale data independently per item.
 * This adapter therefore:
 *
 * - serializes every read, write, and delete on one queue;
 * - splits oversized values into numbered chunks under the platform byte
 *   limit, alternating between two slots;
 * - writes and read-back-verifies all chunks of the new generation first,
 *   publishes the versioned manifest pointer last (the commit point), and
 *   only then cleans the prior complete generation;
 * - verifies a manifest-recorded chunk count, byte count, and SHA-256
 *   digest on every read;
 * - deletes by bounded full sweep with read-back verification.
 *
 * Partial, corrupt, missing, old-format, or unverifiable data raises
 * QuarantineRequiredError — the caller must enter storage quarantine, never
 * signed_out and never authorized. Chunks without a committed manifest are
 * the designed crash-recovery state of the two-phase commit (no session).
 */
import { sha256Hex, utf8ByteLength } from '@/core/sha256';

export interface SecureStoreBackend {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  deleteItem(key: string): Promise<void>;
}

export type QuarantineCode =
  | 'corrupt'
  | 'partial'
  | 'old_format'
  | 'read_rejected'
  | 'write_rejected'
  | 'write_unverified'
  | 'delete_failed'
  | 'residue_after_delete';

export class QuarantineRequiredError extends Error {
  constructor(readonly code: QuarantineCode) {
    super(`Secure storage requires quarantine: ${code}`);
    this.name = 'QuarantineRequiredError';
  }
}

const KEY_PREFIX = 'hive.session';
export const MANIFEST_KEY = `${KEY_PREFIX}.manifest`;
/** Single-key format from before the chunked adapter; never evaluated. */
export const LEGACY_SESSION_KEY = `${KEY_PREFIX}.value`;
export const CHUNK_BYTE_LIMIT = 1900; // under the 2048-byte platform ceiling
export const MAX_CHUNKS = 64;
export const MANIFEST_VERSION = 1;

export function chunkKey(slot: 0 | 1, index: number): string {
  return `${KEY_PREFIX}.s${slot}.c${index}`;
}

interface Manifest {
  v: number;
  generation: number;
  slot: 0 | 1;
  chunkCount: number;
  byteCount: number;
  digest: string;
  /** Chunk count that was live in the *other* slot when this committed. */
  priorChunkCount: number;
}

function parseManifest(raw: string): Manifest | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const m = value as Record<string, unknown>;
  const isInt = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x) && x >= 0;
  if (
    m['v'] !== MANIFEST_VERSION ||
    !isInt(m['generation']) ||
    (m['slot'] !== 0 && m['slot'] !== 1) ||
    !isInt(m['chunkCount']) ||
    (m['chunkCount'] as number) < 1 ||
    (m['chunkCount'] as number) > MAX_CHUNKS ||
    !isInt(m['byteCount']) ||
    typeof m['digest'] !== 'string' ||
    !/^[0-9a-f]{64}$/.test(m['digest']) ||
    !isInt(m['priorChunkCount'])
  ) {
    return null;
  }
  return m as unknown as Manifest;
}

/** Split by UTF-8 byte budget, never splitting a surrogate pair. */
export function splitIntoChunks(value: string, byteLimit = CHUNK_BYTE_LIMIT): string[] {
  const chunks: string[] = [];
  let current = '';
  let currentBytes = 0;
  for (const char of value) {
    const charBytes = utf8ByteLength(char);
    if (currentBytes + charBytes > byteLimit && current.length > 0) {
      chunks.push(current);
      current = '';
      currentBytes = 0;
    }
    current += char;
    currentBytes += charBytes;
  }
  if (current.length > 0) chunks.push(current);
  return chunks.length > 0 ? chunks : [''];
}

export interface SessionStorageEvents {
  onCleanupFailure?: () => void;
}

export class SessionStorageAdapter {
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly backend: SecureStoreBackend,
    private readonly events: SessionStorageEvents = {},
  ) {}

  private enqueue<T>(op: () => Promise<T>): Promise<T> {
    const result = this.queue.then(op);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async getOrQuarantine(key: string, code: QuarantineCode): Promise<string | null> {
    try {
      return await this.backend.getItem(key);
    } catch {
      throw new QuarantineRequiredError(code);
    }
  }

  private async writeVerified(key: string, value: string): Promise<void> {
    try {
      await this.backend.setItem(key, value);
    } catch {
      throw new QuarantineRequiredError('write_rejected');
    }
    const readBack = await this.getOrQuarantine(key, 'write_unverified');
    if (readBack !== value) {
      throw new QuarantineRequiredError('write_unverified');
    }
  }

  read(): Promise<string | null> {
    return this.enqueue(() => this.readInternal());
  }

  private async readInternal(): Promise<string | null> {
    const rawManifest = await this.getOrQuarantine(MANIFEST_KEY, 'read_rejected');
    if (rawManifest === null) {
      const legacy = await this.getOrQuarantine(LEGACY_SESSION_KEY, 'read_rejected');
      if (legacy !== null) {
        // Committed data in a format this version cannot verify.
        throw new QuarantineRequiredError('old_format');
      }
      // Uncommitted chunks (crash before manifest publish) are not a session.
      return null;
    }
    const manifest = parseManifest(rawManifest);
    if (!manifest) {
      throw new QuarantineRequiredError('corrupt');
    }
    let value = '';
    for (let i = 0; i < manifest.chunkCount; i++) {
      const chunk = await this.getOrQuarantine(chunkKey(manifest.slot, i), 'read_rejected');
      if (chunk === null) {
        throw new QuarantineRequiredError('partial');
      }
      value += chunk;
    }
    if (utf8ByteLength(value) !== manifest.byteCount || sha256Hex(value) !== manifest.digest) {
      throw new QuarantineRequiredError('corrupt');
    }
    return value;
  }

  write(value: string): Promise<void> {
    return this.enqueue(() => this.writeInternal(value));
  }

  private async writeInternal(value: string): Promise<void> {
    const chunks = splitIntoChunks(value);
    if (chunks.length > MAX_CHUNKS) {
      throw new Error(`Session value too large: ${chunks.length} chunks exceeds ${MAX_CHUNKS}`);
    }
    const rawManifest = await this.getOrQuarantine(MANIFEST_KEY, 'read_rejected');
    let manifest: Manifest | null = null;
    if (rawManifest !== null) {
      manifest = parseManifest(rawManifest);
      if (!manifest) {
        throw new QuarantineRequiredError('corrupt');
      }
    }
    const newSlot: 0 | 1 = manifest ? (manifest.slot === 0 ? 1 : 0) : 0;
    const staleInNewSlot = manifest?.priorChunkCount ?? 0;

    // Phase 1: write and verify every numbered chunk of the new generation.
    for (let i = 0; i < chunks.length; i++) {
      await this.writeVerified(chunkKey(newSlot, i), chunks[i] as string);
    }
    // Retire stale chunks from two generations ago before committing, so a
    // future manifest can never point at mixed content.
    for (let i = chunks.length; i < staleInNewSlot; i++) {
      try {
        await this.backend.deleteItem(chunkKey(newSlot, i));
      } catch {
        throw new QuarantineRequiredError('delete_failed');
      }
    }

    // Phase 2 (commit): publish the manifest pointer last.
    const next: Manifest = {
      v: MANIFEST_VERSION,
      generation: (manifest?.generation ?? 0) + 1,
      slot: newSlot,
      chunkCount: chunks.length,
      byteCount: utf8ByteLength(value),
      digest: sha256Hex(value),
      priorChunkCount: manifest?.chunkCount ?? 0,
    };
    await this.writeVerified(MANIFEST_KEY, JSON.stringify(next));

    // Post-commit cleanup of the prior complete generation. Failures here
    // self-heal on the next write (priorChunkCount tracks the leftovers),
    // so they must not fail an already-committed write.
    if (manifest) {
      for (let i = 0; i < manifest.chunkCount; i++) {
        try {
          await this.backend.deleteItem(chunkKey(manifest.slot, i));
        } catch {
          this.events.onCleanupFailure?.();
          break;
        }
      }
    }
  }

  delete(): Promise<void> {
    return this.enqueue(() => this.scrubInternal('delete_failed'));
  }

  scrubAll(): Promise<void> {
    return this.enqueue(() => this.scrubInternal('delete_failed'));
  }

  private allKeys(): string[] {
    const keys = [MANIFEST_KEY, LEGACY_SESSION_KEY];
    for (const slot of [0, 1] as const) {
      for (let i = 0; i < MAX_CHUNKS; i++) {
        keys.push(chunkKey(slot, i));
      }
    }
    return keys;
  }

  /** Bounded full sweep with read-back verification: after this resolves,
   * no HIVE session key exists in the keystore. */
  private async scrubInternal(failCode: QuarantineCode): Promise<void> {
    const keys = this.allKeys();
    for (const key of keys) {
      try {
        await this.backend.deleteItem(key);
      } catch {
        throw new QuarantineRequiredError(failCode);
      }
    }
    for (const key of keys) {
      const remaining = await this.getOrQuarantine(key, 'read_rejected');
      if (remaining !== null) {
        throw new QuarantineRequiredError('residue_after_delete');
      }
    }
  }

  hasResidue(): Promise<boolean> {
    return this.enqueue(async () => {
      // Probe the commit point, the legacy key, and the first chunk of each
      // slot: every reachable storage state that holds material touches at
      // least one of these. Unreadable storage counts as residue (fail closed).
      for (const key of [MANIFEST_KEY, LEGACY_SESSION_KEY, chunkKey(0, 0), chunkKey(1, 0)]) {
        try {
          if ((await this.backend.getItem(key)) !== null) return true;
        } catch {
          return true;
        }
      }
      return false;
    });
  }
}
