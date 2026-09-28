import {
  ALLOWED_MIME_TYPES,
  DOCUMENT_LIMITS,
  canAddAnotherDocument,
  checkPickedDocument,
  formatByteSize,
  inferMimeType,
  sanitizeDisplayName,
} from '../document-rules';

describe('inferMimeType', () => {
  it('accepts exactly the four approved types as declared', () => {
    for (const mime of ALLOWED_MIME_TYPES) {
      expect(inferMimeType('anything.bin', mime)).toBe(mime);
    }
  });

  it('normalizes platform aliases and parameters', () => {
    expect(inferMimeType('photo.jpg', 'image/jpg')).toBe('image/jpeg');
    expect(inferMimeType('data.csv', 'text/csv; charset=utf-8')).toBe('text/csv');
    expect(inferMimeType('data.csv', 'APPLICATION/CSV')).toBe('text/csv');
  });

  it('falls back to the extension only when the platform reported nothing useful', () => {
    expect(inferMimeType('statement.pdf', null)).toBe('application/pdf');
    expect(inferMimeType('statement.PDF', 'application/octet-stream')).toBe('application/pdf');
    expect(inferMimeType('scan.jpeg', '*/*')).toBe('image/jpeg');
    // A declared type outside the allowlist is refused even with a
    // plausible extension: the file says it is something else.
    expect(inferMimeType('statement.pdf', 'application/zip')).toBeNull();
    expect(inferMimeType('archive.zip', null)).toBeNull();
    expect(inferMimeType('noextension', null)).toBeNull();
  });
});

describe('sanitizeDisplayName', () => {
  it('drops control characters, trims, and bounds the length', () => {
    expect(sanitizeDisplayName('  june\u0000statement\n.pdf ')).toBe('junestatement.pdf');
    expect(sanitizeDisplayName('x'.repeat(200))).toHaveLength(DOCUMENT_LIMITS.maxDisplayNameLength);
    expect(sanitizeDisplayName('\u0007\u0008')).toBe('Document');
  });
});

describe('checkPickedDocument', () => {
  const base = { uri: 'file:///cache/a.pdf', name: 'a (Synthetic).pdf' };

  it('passes a bounded, typed, named document through', () => {
    const result = checkPickedDocument({ ...base, byteSize: 1234, mimeType: 'application/pdf' });
    expect(result).toEqual({
      ok: true,
      document: {
        uri: base.uri,
        displayName: 'a (Synthetic).pdf',
        byteSize: 1234,
        mimeType: 'application/pdf',
      },
    });
  });

  it('refuses a type outside the allowlist before anything else', () => {
    expect(checkPickedDocument({ ...base, name: 'a.zip', byteSize: 1, mimeType: null })).toEqual({
      ok: false,
      refusal: 'unsupported_type',
    });
  });

  it('refuses an empty or unknown size: nothing is transferred on a guess', () => {
    expect(checkPickedDocument({ ...base, byteSize: 0, mimeType: 'application/pdf' })).toEqual({
      ok: false,
      refusal: 'empty_file',
    });
    expect(checkPickedDocument({ ...base, byteSize: null, mimeType: 'application/pdf' })).toEqual({
      ok: false,
      refusal: 'empty_file',
    });
  });

  it('refuses one byte over the 20 MB limit and accepts the limit itself', () => {
    expect(
      checkPickedDocument({ ...base, byteSize: DOCUMENT_LIMITS.maxBytes + 1, mimeType: null }),
    ).toEqual({ ok: false, refusal: 'file_too_large' });
    expect(
      checkPickedDocument({ ...base, byteSize: DOCUMENT_LIMITS.maxBytes, mimeType: null }).ok,
    ).toBe(true);
  });
});

describe('formatByteSize and the cap', () => {
  it('formats sizes the way a person reads them', () => {
    expect(formatByteSize(12)).toBe('12 bytes');
    expect(formatByteSize(2048)).toBe('2.0 KB');
    expect(formatByteSize(184320)).toBe('180 KB');
    expect(formatByteSize(2411520)).toBe('2.3 MB');
    expect(formatByteSize(-1)).toBe('');
  });

  it('allows a tenth document and refuses an eleventh', () => {
    expect(canAddAnotherDocument(9)).toBe(true);
    expect(canAddAnotherDocument(DOCUMENT_LIMITS.maxPerRequest)).toBe(false);
  });
});
