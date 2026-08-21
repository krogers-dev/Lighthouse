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
