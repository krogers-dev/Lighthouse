/** The device bindings against mocked native modules: what each adapter
 * hands the platform, and what it makes of the platform's answers. The
 * digest contract is pinned here because the first desktop run found it
 * the hard way: expo-crypto's native `digest` converts its data argument
 * as a TYPED ARRAY and refuses a bare ArrayBuffer, which surfaced on the
 * phone only as "Something went wrong" at the check step (2026-09-28). */
import { sha256Hex } from '@/core/sha256';

const mockDigest = jest.fn();
const mockGetDocumentAsync = jest.fn();
const mockFiles = new Map<string, { bytes: Uint8Array; exists: boolean; deleted: number }>();

jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digest: (...args: unknown[]) => mockDigest(...args),
}));

jest.mock('expo-document-picker', () => ({
  getDocumentAsync: (...args: unknown[]) => mockGetDocumentAsync(...args),
}));

jest.mock('expo-file-system', () => ({
  Paths: { cache: 'file:///cache/' },
  File: class MockFile {
    readonly uri: string;
    constructor(...parts: string[]) {
      this.uri = parts.join('');
    }
    get exists(): boolean {
      return mockFiles.get(this.uri)?.exists ?? false;
    }
    async bytes(): Promise<Uint8Array> {
      const entry = mockFiles.get(this.uri);
      if (!entry?.exists) throw new Error(`no such file: ${this.uri}`);
      return entry.bytes;
    }
    write(content: Uint8Array): void {
      mockFiles.set(this.uri, { bytes: content, exists: true, deleted: 0 });
    }
    delete(): void {
      const entry = mockFiles.get(this.uri);
      if (!entry) throw new Error(`no such file: ${this.uri}`);
      entry.exists = false;
      entry.deleted += 1;
    }
  },
}));

// Imported after the mocks are registered.
// eslint-disable-next-line import/first
import {
  expoDigester,
  expoDocumentReader,
  expoDocumentSource,
  writeSyntheticDocumentToCache,
} from '../expo-adapters';

beforeEach(() => {
  mockDigest.mockReset();
  mockGetDocumentAsync.mockReset();
  mockFiles.clear();
});

describe('expoDigester', () => {
  it('hands the native digest a typed array over exactly the bytes, never a bare buffer', async () => {
    const backing = new Uint8Array([9, 9, 1, 2, 3, 9]);
    const view = backing.subarray(2, 5);
    mockDigest.mockImplementation(async (algorithm: string, data: unknown) => {
      expect(algorithm).toBe('SHA-256');
      expect(ArrayBuffer.isView(data)).toBe(true);
      const typed = data as Uint8Array;
      expect(Array.from(typed)).toEqual([1, 2, 3]);
      expect(typed.byteOffset).toBe(0);
      expect(typed.byteLength).toBe(typed.buffer.byteLength);
      // The platform answers with an ArrayBuffer of the digest bytes.
      const hex = sha256Hex(typed);
      return Uint8Array.from(hex.match(/../g)!.map((h) => parseInt(h, 16))).buffer;
    });
    await expect(expoDigester.sha256Hex(view)).resolves.toBe(sha256Hex(new Uint8Array([1, 2, 3])));
    expect(mockDigest).toHaveBeenCalledTimes(1);
  });
});

describe('expoDocumentSource', () => {
  it('asks for one file of the four approved types, copied into the cache', async () => {
    mockGetDocumentAsync.mockResolvedValue({ canceled: true, assets: null });
    await expect(expoDocumentSource.pick()).resolves.toBeNull();
    expect(mockGetDocumentAsync).toHaveBeenCalledWith({
      type: ['application/pdf', 'image/png', 'image/jpeg', 'text/csv'],
      multiple: false,
      copyToCacheDirectory: true,
    });
  });

  it('maps a picked asset, tolerating a missing size or type', async () => {
    mockGetDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///cache/a.pdf', name: 'a (Synthetic).pdf' }],
    });
    await expect(expoDocumentSource.pick()).resolves.toEqual({
      uri: 'file:///cache/a.pdf',
      name: 'a (Synthetic).pdf',
      byteSize: null,
      mimeType: null,
    });
    mockGetDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///cache/b.png', name: 'b.png', size: 12, mimeType: 'image/png' }],
    });
    await expect(expoDocumentSource.pick()).resolves.toMatchObject({
      byteSize: 12,
      mimeType: 'image/png',
    });
  });
});

describe('expoDocumentReader and the synthetic writer', () => {
  it('reads what was written to the cache and discards it once, tolerating a second discard', async () => {
    const bytes = new Uint8Array([37, 80, 68, 70]);
    const uri = await writeSyntheticDocumentToCache('hive-qa (Synthetic).pdf', bytes);
    expect(uri).toBe('file:///cache/hive-qa (Synthetic).pdf');
    await expect(expoDocumentReader.read(uri)).resolves.toEqual(bytes);
    await expoDocumentReader.discard(uri);
    expect(mockFiles.get(uri)?.exists).toBe(false);
    // Gone already: discard does not throw for a file that is not there.
    await expect(expoDocumentReader.discard(uri)).resolves.toBeUndefined();
    expect(mockFiles.get(uri)?.deleted).toBe(1);
  });

  it('rewrites the synthetic document in place when a previous copy exists', async () => {
    await writeSyntheticDocumentToCache('x.pdf', new Uint8Array([1]));
    const uri = await writeSyntheticDocumentToCache('x.pdf', new Uint8Array([2, 3]));
    await expect(expoDocumentReader.read(uri)).resolves.toEqual(new Uint8Array([2, 3]));
  });
});
