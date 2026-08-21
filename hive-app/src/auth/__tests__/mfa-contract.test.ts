import { decodeSupabaseTotpQr, splitTotpFactors } from '../mfa-contract';

/** Exact factor rows as supabase-js 2.112.3 mfa.listFactors returns them. */
function factor(id: string, factorType: string, status: string) {
  return {
    id,
    friendly_name: '',
    factor_type: factorType,
    status,
    created_at: '2026-08-21T00:00:00.000000Z',
    updated_at: '2026-08-21T00:00:00.000000Z',
  };
}

describe('splitTotpFactors (pinned listFactors contract)', () => {
  it('finds unverified factors in data.all — data.totp is verified-only', () => {
    // The exact shape the client returns after an interrupted enrollment:
    // the unverified factor appears ONLY in `all`; `totp` is empty.
    const data = {
      all: [factor('f-unverified-1', 'totp', 'unverified')],
      totp: [],
      phone: [],
    };
    const split = splitTotpFactors(data);
    expect(split.verifiedId).toBeNull();
    expect(split.unverifiedIds).toEqual(['f-unverified-1']);
  });

  it('separates verified and unverified and ignores phone factors', () => {
    const data = {
      all: [
        factor('f-phone', 'phone', 'verified'),
        factor('f-old-1', 'totp', 'unverified'),
        factor('f-live', 'totp', 'verified'),
        factor('f-old-2', 'totp', 'unverified'),
      ],
      totp: [factor('f-live', 'totp', 'verified')],
      phone: [factor('f-phone', 'phone', 'verified')],
    };
    const split = splitTotpFactors(data);
    expect(split.verifiedId).toBe('f-live');
    expect(split.unverifiedIds).toEqual(['f-old-1', 'f-old-2']);
  });

  it('treats unknown statuses as unverified (fail closed)', () => {
    const split = splitTotpFactors({ all: [factor('f-weird', 'totp', 'pending')] });
    expect(split.verifiedId).toBeNull();
    expect(split.unverifiedIds).toEqual(['f-weird']);
  });

  it('handles empty and missing payloads', () => {
    expect(splitTotpFactors(null)).toEqual({ verifiedId: null, unverifiedIds: [] });
    expect(splitTotpFactors({})).toEqual({ verifiedId: null, unverifiedIds: [] });
    expect(splitTotpFactors({ all: null })).toEqual({ verifiedId: null, unverifiedIds: [] });
  });
});

describe('decodeSupabaseTotpQr (pinned enroll contract)', () => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 29 29"><path d="M0 0h1v1H0z"/></svg>';

  it('decodes the exact gotrue-js data URI shape', () => {
    // gotrue-js wraps the server SVG as `data:image/svg+xml;utf-8,${svg}`.
    expect(decodeSupabaseTotpQr(`data:image/svg+xml;utf-8,${svg}`)).toBe(svg);
  });

  it('decodes percent-encoded payloads', () => {
    expect(decodeSupabaseTotpQr(`data:image/svg+xml,${encodeURIComponent(svg)}`)).toBe(svg);
  });

  it('accepts bare SVG XML', () => {
    expect(decodeSupabaseTotpQr(svg)).toBe(svg);
  });

  it('returns null for non-SVG, foreign data URIs, and empty values', () => {
    expect(decodeSupabaseTotpQr('data:image/png;base64,AAAA')).toBeNull();
    expect(decodeSupabaseTotpQr('not svg at all')).toBeNull();
    expect(decodeSupabaseTotpQr('')).toBeNull();
    expect(decodeSupabaseTotpQr(null)).toBeNull();
    expect(decodeSupabaseTotpQr(undefined)).toBeNull();
  });

  it('rejects active content defensively', () => {
    expect(decodeSupabaseTotpQr('<svg><script>1</script></svg>')).toBeNull();
    expect(decodeSupabaseTotpQr('<svg><foreignObject/></svg>')).toBeNull();
    expect(decodeSupabaseTotpQr('<svg onload="x"></svg>')).toBeNull();
  });
});
