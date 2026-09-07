/** Pure adapters for the pinned supabase-js 2.112.3 MFA response shapes
 * (second RETURN directive, area 2). Unit-tested against the exact
 * contract in __tests__/mfa-contract.test.ts.
 *
 * Two real-client behaviors these encode:
 * - `mfa.enroll` returns `totp.qr_code` as a data URI
 *   (`data:image/svg+xml;utf-8,<svg …>`), NOT raw SVG XML. It must be
 *   decoded and validated before any renderer sees it.
 * - `mfa.listFactors` returns unverified factors only in `data.all`;
 *   `data.totp` holds VERIFIED totp factors only. Unverified discovery
 *   must therefore filter `all` by factor type and status.
 */

/** The Factor shape supabase-js 2.112.3 returns from mfa.listFactors. */
export interface SupabaseMfaFactor {
  id: string;
  friendly_name?: string;
  factor_type: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface SupabaseListFactorsData {
  all?: SupabaseMfaFactor[] | null;
  totp?: SupabaseMfaFactor[] | null;
  phone?: SupabaseMfaFactor[] | null;
}

export interface TotpFactorSplit {
  verifiedId: string | null;
  unverifiedIds: string[];
}

/** Derive TOTP factors from `data.all`, filtering by factor type and
 * status. Anything not explicitly 'verified' is treated as unverified
 * (fail closed): it must be cleaned up, never trusted. */
export function splitTotpFactors(
  data: SupabaseListFactorsData | null | undefined,
): TotpFactorSplit {
  const all = Array.isArray(data?.all) ? data.all : [];
  const totp = all.filter((factor) => factor.factor_type === 'totp');
  const verified = totp.find((factor) => factor.status === 'verified');
  return {
    verifiedId: verified?.id ?? null,
    unverifiedIds: totp.filter((factor) => factor.status !== 'verified').map((factor) => factor.id),
  };
}

const DATA_URI_PREFIXES = [
  'data:image/svg+xml;utf-8,',
  'data:image/svg+xml;utf8,',
  'data:image/svg+xml;charset=utf-8,',
  'data:image/svg+xml,',
];

/** Decode supabase-js's TOTP QR value into validated SVG XML, or null if
 * it cannot be safely rendered (the view then shows the manual setup key
 * only — enrollment still completes). Never throws. */
export function decodeSupabaseTotpQr(qrCode: string | null | undefined): string | null {
  if (typeof qrCode !== 'string' || qrCode.length === 0) return null;
  let xml = qrCode;
  for (const prefix of DATA_URI_PREFIXES) {
    if (xml.startsWith(prefix)) {
      xml = xml.slice(prefix.length);
      break;
    }
  }
  if (xml.startsWith('data:')) return null; // some other data URI type
  if (xml.includes('%3C') || xml.includes('%3c')) {
    try {
      xml = decodeURIComponent(xml);
    } catch {
      return null;
    }
  }
  xml = xml.trim();
  // The local GoTrue returns a whole SVG DOCUMENT — an XML declaration and
  // a DOCTYPE before the root — rather than a data URI or a bare <svg>.
  // Requiring a leading '<svg' rejected it, the enrollment screen silently
  // fell back to the setup key, and the QR assertion failed on the first
  // device run of that flow (find 28, 2026-09-04).
  //
  // The prolog is STRIPPED rather than allowed through: an internal subset
  // is where entity declarations live, and this string is handed to a
  // renderer, so a doctype carrying one is refused outright rather than
  // sanitised.
  if (/<!ENTITY/i.test(xml)) return null;
  // Strip the document prolog: an XML declaration, a DOCTYPE, and comments
  // may each appear before the root, in any order and more than once. This
  // GoTrue emits a declaration then a generator COMMENT. Bounded so a
  // pathological value cannot spin.
  for (let guard = 0; guard < 16; guard += 1) {
    xml = xml.trimStart();
    if (/^<\?xml/i.test(xml)) {
      const close = xml.indexOf('?>');
      if (close === -1) return null;
      xml = xml.slice(close + 2);
      continue;
    }
    if (xml.startsWith('<!--')) {
      const close = xml.indexOf('-->');
      if (close === -1) return null;
      xml = xml.slice(close + 3);
      continue;
    }
    if (/^<!DOCTYPE/i.test(xml)) {
      const close = xml.indexOf('>');
      if (close === -1) return null;
      // An internal subset is where entity declarations live, and this
      // string goes to a renderer: refused outright rather than sanitised.
      if (xml.slice(0, close + 1).includes('[')) return null;
      xml = xml.slice(close + 1);
      continue;
    }
    break;
  }
  xml = xml.trim();
  if (!xml.startsWith('<svg') || !xml.endsWith('</svg>')) return null;
  // Defense in depth for a value handed to a renderer: static shapes only.
  const lowered = xml.toLowerCase();
  if (
    lowered.includes('<script') ||
    lowered.includes('<foreignobject') ||
    lowered.includes('javascript:') ||
    /\son\w+\s*=/.test(lowered)
  ) {
    return null;
  }
  return xml;
}

/** Collapse a QR SVG's thousands of `<rect>` modules into ONE `<path>` per
 * colour.
 *
 * GoTrue draws every QR module as its own `<rect>`, which react-native-svg
 * turns into its own native view: the enrollment screen carried thousands
 * of them, every Maestro view-hierarchy dump on that screen took tens of
 * seconds, and a TOTP code fetched immediately before typing was already
 * ~60 seconds old when it submitted — right at GoTrue's tolerance, which
 * is why that flow passed once and then stopped (find 33, 2026-09-04).
 * Hiding the modules from the ACCESSIBILITY tree did not help, because the
 * cost is the view count itself.
 *
 * The geometry is preserved exactly — every module still drawn, same
 * coordinates, same colours — it is simply expressed as path data instead
 * of elements, which is one view instead of thousands.
 *
 * FAILS SAFE: anything this does not fully understand (a non-rect element,
 * a coordinate that is not a plain number, a fill that is not a plain
 * colour) returns the input UNCHANGED rather than a badly rewritten SVG.
 * The fill is copied into the output, so it is the one attribute that
 * could carry something other than what it claims; only `#rgb`-style hex
 * and bare colour words are accepted. */
const RECT_TAG = /<rect\b([^>]*)\/>/g;
const ATTR = /([a-zA-Z-]+)\s*=\s*"([^"]*)"/g;
const PLAIN_NUMBER = /^-?\d+(?:\.\d+)?$/;
const PLAIN_COLOUR = /^(?:#[0-9a-fA-F]{3,8}|[a-zA-Z]+)$/;

export function flattenQrSvg(svg: string | null): string | null {
  if (svg === null) return null;
  const openEnd = svg.indexOf('>');
  if (!svg.startsWith('<svg') || openEnd === -1 || !svg.endsWith('</svg>')) return svg;
  const openTag = svg.slice(0, openEnd + 1);
  const body = svg.slice(openEnd + 1, svg.length - '</svg>'.length);

  const byFill = new Map<string, string[]>();
  let consumed = '';
  RECT_TAG.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = RECT_TAG.exec(body)) !== null) {
    const attrs: Record<string, string> = {};
    ATTR.lastIndex = 0;
    let attr: RegExpExecArray | null;
    while ((attr = ATTR.exec(match[1] as string)) !== null) {
      attrs[attr[1] as string] = attr[2] as string;
    }
    const { x = '0', y = '0', width, height, fill = '' } = attrs;
    if (width === undefined || height === undefined) return svg;
    for (const value of [x, y, width, height]) {
      if (!PLAIN_NUMBER.test(value)) return svg;
    }
    if (fill !== '' && !PLAIN_COLOUR.test(fill)) return svg;
    const list = byFill.get(fill) ?? [];
    list.push(`M${x} ${y}h${width}v${height}h-${width}z`);
    byFill.set(fill, list);
    consumed += match[0];
  }
  if (byFill.size === 0) return svg;
  // Every non-rect byte must be whitespace: a body this does not account
  // for in full is left alone rather than partially rewritten.
  if (body.split(consumed).join('').trim() !== '' && body.replace(RECT_TAG, '').trim() !== '') {
    return svg;
  }

  const paths = [...byFill.entries()]
    .map(([fill, data]) =>
      fill === '' ? `<path d="${data.join('')}"/>` : `<path fill="${fill}" d="${data.join('')}"/>`,
    )
    .join('');
  return `${openTag}${paths}</svg>`;
}
