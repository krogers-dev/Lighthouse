import type { DocumentSource } from '@/features/documents/ports';

import {
  QA_SYNTHETIC_DOCUMENT_MARKER,
  SYNTHETIC_DOCUMENT_MIME,
  SYNTHETIC_DOCUMENT_NAME,
  armSyntheticDocument,
  disarmSyntheticDocument,
  isQaSyntheticDocumentUrl,
  isSyntheticDocumentArmed,
  syntheticDocumentBytes,
  withSyntheticDocumentSource,
} from '../qa-synthetic-document';

const realPick = {
  uri: 'content://real/1',
  name: 'real.pdf',
  byteSize: 9,
  mimeType: 'application/pdf',
};

const real: DocumentSource = { pick: async () => realPick };

afterEach(() => disarmSyntheticDocument());

describe('dev-only QA synthetic document source', () => {
  it('recognizes exactly the QA deep link, never a substring or an extra parameter', () => {
    expect(isQaSyntheticDocumentUrl('hivedev:///?qa=synthetic-document')).toBe(true);
    expect(isQaSyntheticDocumentUrl('hivedev://dashboard')).toBe(false);
    expect(isQaSyntheticDocumentUrl('https://evil.example/?qa=synthetic-document')).toBe(false);
    expect(isQaSyntheticDocumentUrl('hivedev:///?qa=synthetic-document-extra')).toBe(false);
    expect(isQaSyntheticDocumentUrl('hivedev:///nested?qa=synthetic-document')).toBe(false);
    expect(isQaSyntheticDocumentUrl('hivedev://other/?qa=synthetic-document')).toBe(false);
    expect(isQaSyntheticDocumentUrl('hivedev:///?qa=synthetic-document&x=1')).toBe(false);
    expect(isQaSyntheticDocumentUrl('hivedev:///?qa=corrupt-storage')).toBe(false);
    expect(isQaSyntheticDocumentUrl('not a url')).toBe(false);
  });

  it('hands every pick to the real picker while unarmed', async () => {
    const write = jest.fn();
    const source = withSyntheticDocumentSource(real, write);
    expect(await source.pick()).toEqual(realPick);
    expect(write).not.toHaveBeenCalled();
    expect(isSyntheticDocumentArmed()).toBe(false);
  });

  it('answers exactly one pick with the synthetic PDF once armed, then disarms', async () => {
    const write = jest.fn(async (name: string) => `file:///cache/${name}`);
    const source = withSyntheticDocumentSource(real, write);
    armSyntheticDocument();
    expect(isSyntheticDocumentArmed()).toBe(true);
    const picked = await source.pick();
    expect(picked).toEqual({
      uri: `file:///cache/${SYNTHETIC_DOCUMENT_NAME}`,
      name: SYNTHETIC_DOCUMENT_NAME,
      byteSize: syntheticDocumentBytes().byteLength,
      mimeType: SYNTHETIC_DOCUMENT_MIME,
    });
    expect(write).toHaveBeenCalledWith(SYNTHETIC_DOCUMENT_NAME, expect.any(Uint8Array));
    expect(isSyntheticDocumentArmed()).toBe(false);
    // The next pick is the real one again.
    expect(await source.pick()).toEqual(realPick);
  });

  it('disarms before writing, so a failed write never re-arms itself', async () => {
    const write = jest.fn(async () => {
      throw new Error('disk full');
    });
    const source = withSyntheticDocumentSource(real, write);
    armSyntheticDocument();
    await expect(source.pick()).rejects.toThrow('disk full');
    expect(isSyntheticDocumentArmed()).toBe(false);
  });

  it('produces a clearly synthetic PDF and carries the provable marker', () => {
    const bytes = syntheticDocumentBytes();
    const head = String.fromCharCode(...bytes.subarray(0, 8));
    expect(head).toBe('%PDF-1.4');
    expect(String.fromCharCode(...bytes)).toContain('(Synthetic)');
    expect(SYNTHETIC_DOCUMENT_NAME).toContain('(Synthetic)');
    expect(QA_SYNTHETIC_DOCUMENT_MARKER).toBe('HIVE_QA_SYNTHETIC_DOCUMENT_HOOK');
  });
});
