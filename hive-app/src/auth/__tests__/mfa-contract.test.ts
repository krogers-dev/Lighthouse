import { decodeSupabaseTotpQr, flattenQrSvg, splitTotpFactors } from '../mfa-contract';

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

describe('decodeSupabaseTotpQr: XML prolog and DOCTYPE (find 28)', () => {
  // The local GoTrue returns the QR as a whole SVG DOCUMENT — an XML
  // declaration, then a DOCTYPE, then the <svg> root — not a data: URI and
  // not a bare <svg>. The decoder required a leading '<svg', so it returned
  // null, the enrollment screen fell back to the setup key, and
  // mfa-enroll.yaml failed on `mfa-enroll-qr` at the first device run of
  // this flow. Shape confirmed by probing the live stack (value never
  // printed: the QR encodes the secret).
  const svgBody = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>';

  it('accepts an XML declaration before the root', () => {
    expect(decodeSupabaseTotpQr(`<?xml version="1.0"?>\n${svgBody}`)).toBe(svgBody);
  });

  it('accepts the declaration plus a plain DOCTYPE, as GoTrue emits', () => {
    const doc = `<?xml version="1.0"?>\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n${svgBody}`;
    expect(decodeSupabaseTotpQr(doc)).toBe(svgBody);
  });

  // A DOCTYPE internal subset is where entity declarations live, and an
  // SVG handed to a renderer must not carry them: accepting the prolog
  // must not become accepting arbitrary doctype content.
  it('REFUSES a DOCTYPE carrying an internal subset', () => {
    const withSubset = `<!DOCTYPE svg [<!ENTITY xxe "gotcha">]>\n${svgBody}`;
    expect(decodeSupabaseTotpQr(withSubset)).toBeNull();
  });

  it('REFUSES an entity declaration anywhere', () => {
    expect(decodeSupabaseTotpQr(`<?xml version="1.0"?><!ENTITY a "b">${svgBody}`)).toBeNull();
  });

  it('still refuses script and handlers after a legitimate prolog', () => {
    const doc = `<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"><script>x()</script></svg>`;
    expect(decodeSupabaseTotpQr(doc)).toBeNull();
    const handler = `<?xml version="1.0"?>\n<svg onload="x()"><rect/></svg>`;
    expect(decodeSupabaseTotpQr(handler)).toBeNull();
  });

  it('refuses a prolog with nothing after it', () => {
    expect(decodeSupabaseTotpQr('<?xml version="1.0"?>')).toBeNull();
    expect(decodeSupabaseTotpQr('<?xml version="1.0"?><!DOCTYPE svg>')).toBeNull();
  });
});

describe('decodeSupabaseTotpQr: the prolog GoTrue actually emits', () => {
  const svgBody = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>';

  // Probed against the live stack: a declaration, then a GENERATOR COMMENT,
  // then the root. The comment is what the first fix missed — it was
  // mistaken for a DOCTYPE from a masked character dump, which is why the
  // flow failed twice on the same assertion.
  it('accepts a declaration followed by a comment, as GoTrue emits', () => {
    const doc = `<?xml version="1.0"?>\n<!-- Generator: some qr library -->\n${svgBody}`;
    expect(decodeSupabaseTotpQr(doc)).toBe(svgBody);
  });

  it('accepts several prolog parts in any order', () => {
    const doc = `<!-- one -->\n<?xml version="1.0"?>\n<!-- two -->\n<!DOCTYPE svg>\n${svgBody}`;
    expect(decodeSupabaseTotpQr(doc)).toBe(svgBody);
  });

  it('REFUSES an unterminated comment or declaration', () => {
    expect(decodeSupabaseTotpQr(`<!-- never closed ${svgBody}`)).toBeNull();
    expect(decodeSupabaseTotpQr(`<?xml version="1.0" ${svgBody}`)).toBeNull();
  });

  it('REFUSES active content hidden after a comment', () => {
    const doc = `<!-- looks fine --><svg><script>x()</script></svg>`;
    expect(decodeSupabaseTotpQr(doc)).toBeNull();
  });

  it('REFUSES a comment-only value with no root element', () => {
    expect(decodeSupabaseTotpQr('<!-- nothing here -->')).toBeNull();
  });
});

describe('flattenQrSvg: one path per colour instead of thousands of rects (find 33)', () => {
  const root =
    '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 29 29">';
  const rects = (n: number, fill: string) =>
    Array.from(
      { length: n },
      (_, i) => `<rect x="${i}" y="${i}" width="1" height="1" fill="${fill}"/>`,
    ).join('');

  it('collapses same-coloured rects into a single path', () => {
    const svg = `${root}${rects(500, '#000000')}</svg>`;
    const out = flattenQrSvg(svg) as string;
    expect(out).not.toBeNull();
    expect((out.match(/<rect/g) ?? []).length).toBe(0);
    expect((out.match(/<path/g) ?? []).length).toBe(1);
    // Every module still has to be drawn — the geometry is preserved, not
    // simplified away.
    expect((out.match(/M/g) ?? []).length).toBe(500);
  });

  it('keeps one path per distinct colour, and keeps the root attributes', () => {
    const svg = `${root}${rects(10, '#ffffff')}${rects(10, '#000000')}</svg>`;
    const out = flattenQrSvg(svg) as string;
    expect((out.match(/<path/g) ?? []).length).toBe(2);
    expect(out).toContain('viewBox="0 0 29 29"');
    expect(out).toContain('width="256"');
    expect(out.startsWith('<svg')).toBe(true);
    expect(out.endsWith('</svg>')).toBe(true);
  });

  // Failing safe matters more than flattening: a shape this does not fully
  // understand is returned untouched rather than rewritten badly.
  it('returns the input UNCHANGED when the body is not purely rects', () => {
    const svg = `${root}<circle cx="1" cy="1" r="1"/>${rects(5, '#000')}</svg>`;
    expect(flattenQrSvg(svg)).toBe(svg);
  });

  it('returns the input UNCHANGED on a non-numeric coordinate', () => {
    const svg = `${root}<rect x="1" y="oops" width="1" height="1" fill="#000"/></svg>`;
    expect(flattenQrSvg(svg)).toBe(svg);
  });

  // The fill is copied into the output, so it must not be able to carry
  // anything but a colour.
  it('returns the input UNCHANGED on a fill that is not a plain colour', () => {
    const svg = `${root}<rect x="1" y="1" width="1" height="1" fill="url(#x)&quot; onload=&quot;x()"/></svg>`;
    expect(flattenQrSvg(svg)).toBe(svg);
  });

  it('passes null through', () => {
    expect(flattenQrSvg(null)).toBeNull();
  });

  it('output still survives the decoder it will be handed to', () => {
    const svg = `${root}${rects(50, '#000000')}</svg>`;
    const out = flattenQrSvg(svg) as string;
    expect(decodeSupabaseTotpQr(out)).toBe(out);
  });
});
