/** HIVE_QA_EXPIRE_HOOK — development-only session-expiry hook (find 20).
 *
 * The expired-session device flow needs an executable way to make the
 * STORED session expired — not corrupt. A server-side session revoke
 * cannot produce that state: the app reads its session locally with
 * `autoRefreshToken: false`, so the stored access token is a JWT that
 * PostgREST validates statelessly until its own `exp`, and the app's
 * boot check keys off the session's `expires_at`, never off server
 * session rows (find 20, 2026-09-04). This hook rewrites the persisted
 * session's `expires_at` into the past THROUGH the versioned storage
 * adapter, so the digest is recomputed and the session still VERIFIES —
 * it is simply expired. The next boot takes the expiry branch and lands
 * on signed_out with the "session ended" reason, never quarantine.
 *
 * This is the deliberate counterpart to qa-corrupt-storage: corruption
 * makes the session UNVERIFIABLE (-> storage_quarantined); expiry makes
 * it VALID-BUT-EXPIRED (-> signed_out, reason 'expired'). The two device
 * states are distinct and both need an executable pre-step.
 *
 * Ship-safety, proven by gates rather than promised, exactly as the
 * corruption hook:
 *  - reachable only behind `__DEV__ && EXPO_PUBLIC_QA_HOOKS === '1'`
 *    (app/_layout.tsx); metro.config.js resolves this import to the inert
 *    stub unless QA hooks are enabled at build time, so the marker string
 *    `HIVE_QA_EXPIRE_HOOK` below never enters a non-QA dependency graph;
 *  - `bundle:inspect` proves that marker absent from every
 *    non-development export (qa-hook-marker pattern);
 *  - `config:check` rejects EXPO_PUBLIC_QA_HOOKS for candidate/release.
 * It touches only the HIVE session envelope, never reads token contents
 * beyond the expiry fields, and never logs anything.
 */
import { SessionStorageAdapter, type SecureStoreBackend } from '@/auth/secure-store-adapter';

export const QA_EXPIRE_HOOK_MARKER = 'HIVE_QA_EXPIRE_HOOK';

/** The one exact QA deep link: hivedev:///?qa=expire-session
 *
 * Same shape law as the corruption link (find 24): it addresses the ROOT
 * with a query rather than a path, so Expo Router navigates to a route
 * that already exists and Linking still delivers the whole URL — a
 * `hivedev://qa/expire-session` path would be claimed as a (nonexistent)
 * route and this listener would never run. */
export const QA_EXPIRE_SCHEME = 'hivedev:';
export const QA_EXPIRE_PARAM = 'qa';
export const QA_EXPIRE_VALUE = 'expire-session';

/** A fixed past instant (2001-09-09T01:46:40Z, epoch second 1_000_000_000)
 * — unambiguously expired for any plausible test clock, and a constant so
 * the write is deterministic. */
const EXPIRED_AT_SECONDS = 1_000_000_000;

/** Exact scheme, no host, root path, and exactly ONE query parameter with
 * exactly the expected value (RETURN-3 area 8) — parsed, never
 * substring-matched. `https://evil/?qa=expire-session`,
 * `hivedev://evil/?qa=expire-session`, a trailing path, a longer value,
 * and any extra parameter riding along all fail to trigger the hook. */
export function isQaExpireUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== QA_EXPIRE_SCHEME) return false;
  if (parsed.hostname !== '') return false;
  if (parsed.pathname !== '' && parsed.pathname !== '/') return false;
  const params = [...parsed.searchParams.entries()];
  if (params.length !== 1) return false;
  const [[name, value]] = params as [[string, string]];
  return name === QA_EXPIRE_PARAM && value === QA_EXPIRE_VALUE;
}

/** Rewrite a persisted Supabase session envelope's expiry to the past,
 * preserving every other field. Returns null when the input is not a
 * JSON object carrying a session (nothing to expire) so the caller can
 * fail loudly rather than write a fabricated session. */
export function expireSessionEnvelope(raw: string): string | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const session = value as Record<string, unknown>;
  // A real persisted session carries an access token and an expiry; if
  // neither is present this is not a session envelope.
  if (!('access_token' in session) && !('expires_at' in session)) return null;
  return JSON.stringify({
    ...session,
    expires_at: EXPIRED_AT_SECONDS,
    expires_in: 0,
  });
}

/** Make the stored session expired-but-verifiable. No-ops (throws
 * nothing the caller must handle beyond the returned flag) when there is
 * no readable session to expire, so the flow's completion acknowledgment
 * — which only renders on a true return — times out and fails loudly
 * instead of asserting against a state the pre-step never produced. */
export async function expireStoredSessionForQa(backend: SecureStoreBackend): Promise<boolean> {
  const adapter = new SessionStorageAdapter(backend);
  let stored: string | null;
  try {
    stored = await adapter.read();
  } catch {
    // Corrupt/partial storage is the corruption hook's domain, not this
    // one; do not fabricate a session over it.
    return false;
  }
  if (stored === null) return false;
  const expired = expireSessionEnvelope(stored);
  if (expired === null) return false;
  try {
    await adapter.write(expired);
  } catch {
    return false;
  }
  return true;
}
