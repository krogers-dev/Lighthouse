/** HIVE_QA_CORRUPT_HOOK — development-only storage-corruption hook
 * (second RETURN directive, area 7).
 *
 * The quarantine device flow needs an executable way to make the stored
 * session unverifiable. This module overwrites the session manifest with
 * a non-JSON marker value so the next boot's digest/shape verification
 * fails closed into `storage_quarantined`.
 *
 * Ship-safety, proven by gates rather than promised:
 *  - It is reachable only behind `__DEV__ && EXPO_PUBLIC_QA_HOOKS === '1'`
 *    (app/_layout.tsx); Metro's release dead-code elimination drops the
 *    whole require. The marker string `HIVE_QA_CORRUPT_HOOK` below exists
 *    so `bundle:inspect` can PROVE absence in any non-development export.
 *  - `config:check` rejects EXPO_PUBLIC_QA_HOOKS for candidate/release
 *    profiles.
 * It touches only the HIVE manifest key, never reads session content, and
 * never logs anything.
 */
import { MANIFEST_KEY, type SecureStoreBackend } from '@/auth/secure-store-adapter';

export const QA_CORRUPT_HOOK_MARKER = 'HIVE_QA_CORRUPT_HOOK';

/** The one exact QA deep link: hivedev:///?qa=corrupt-storage
 *
 * It addresses the ROOT with a query rather than a path, and that shape is
 * load-bearing. The previous link, `hivedev://qa/corrupt-storage`, was
 * claimed by EXPO ROUTER as the route `/qa/corrupt-storage` — which does
 * not exist — so the router rendered its "Unmatched Route" screen and this
 * module's listener never ran (find 24, proven on device). A QA-only route
 * would fix that by shipping a route in the release bundle, which is the
 * wrong trade. The root resolves to a route that already exists, so the
 * router navigates normally and Linking still delivers the whole URL. */
export const QA_CORRUPT_SCHEME = 'hivedev:';
export const QA_CORRUPT_PARAM = 'qa';
export const QA_CORRUPT_VALUE = 'corrupt-storage';

/** Exact scheme, no host, root path, and exactly ONE query parameter with
 * exactly the expected value (RETURN-3 area 8) — parsed, never
 * substring-matched. `https://evil/?qa=corrupt-storage`,
 * `hivedev://evil/?qa=corrupt-storage`, a trailing path, a longer value,
 * and any extra parameter riding along all fail to trigger the hook. */
export function isQaCorruptUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== QA_CORRUPT_SCHEME) return false;
  if (parsed.hostname !== '') return false;
  if (parsed.pathname !== '' && parsed.pathname !== '/') return false;
  const params = [...parsed.searchParams.entries()];
  if (params.length !== 1) return false;
  const [[name, value]] = params as [[string, string]];
  return name === QA_CORRUPT_PARAM && value === QA_CORRUPT_VALUE;
}

export async function corruptStoredSessionForQa(backend: SecureStoreBackend): Promise<void> {
  await backend.setItem(MANIFEST_KEY, `${QA_CORRUPT_HOOK_MARKER}:not-a-manifest`);
}
