/** HIVE_QA_EXPIRE_HOOK — development-only session-expiry hook (find 20).
 *
 * The expired-session device flow needs an executable way to make the
 * STORED session expired — not corrupt. A server-side session revoke
 * cannot produce that state on its own: the stored access token is a JWT
 * that stays usable until its own `exp`, an hour out (find 20,
 * 2026-09-04). And expiring the stored token alone is not enough either:
 * the auth library refreshes a lapsed stored session at boot regardless
 * of `autoRefreshToken` (2026-09-06 review), so a valid refresh token
 * would silently resurrect it. This hook therefore rewrites the persisted
 * session THROUGH the versioned storage adapter — digest recomputed, so it
 * still VERIFIES — with `expires_at` in the past AND an inert refresh
 * token. The next boot attempts the refresh, the auth server definitively
 * rejects it, the gateway maps that rejection to SessionExpiredError, and
 * the controller takes the expiry branch: local cleanup, then signed_out
 * with the "session ended" reason. Never quarantine, never fatal.
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

/** An obviously synthetic, inert refresh token. The auth library refreshes
 * a lapsed stored session at boot regardless of autoRefreshToken (2026-09-06
 * review), so expiring the access token alone would be silently undone by
 * a valid refresh token. With this value in its place the refresh is
 * definitively REJECTED (invalid_grant), which the gateway maps to the
 * expiry branch — exactly the real "revoked session" shape. */
export const QA_EXPIRED_REFRESH_TOKEN = 'HIVE_QA_EXPIRED_REFRESH_TOKEN';

/** How long the hook waits before quiescing the running app (find 39).
 *
 * Opening the QA link resumes the activity, and the controller restarts
 * the auth library's foreground refresh on every resume; that restart
 * runs a tick at once, and the tick reads the stored session. Had the
 * expired envelope already been written, the RUNNING app would consume
 * it — refresh rejected, session removed, signed out with the reason —
 * and the relaunch the flow is really testing would then find no session
 * at all and show no notice (the 2026-09-06 desktop run). So the hook
 * lets the resume cycle finish on the still-valid session, has the
 * caller stop the foreground refresh, and only then writes. */
export const QA_EXPIRE_QUIESCE_MS = 750;

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
    refresh_token: QA_EXPIRED_REFRESH_TOKEN,
  });
}

/** Make the stored session expired-but-verifiable. No-ops (throws
 * nothing the caller must handle beyond the returned flag) when there is
 * no readable session to expire, so the flow's completion acknowledgment
 * — which only renders on a true return — times out and fails loudly
 * instead of asserting against a state the pre-step never produced. */
export async function expireStoredSessionForQa(
  backend: SecureStoreBackend,
  quiesce?: () => Promise<void>,
): Promise<boolean> {
  // Find 39: the running app must not act on the expired envelope before
  // the flow restarts it. The caller stops the foreground refresh here;
  // the write happens only after that has settled.
  if (quiesce) await quiesce();
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
