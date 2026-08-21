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

/** The one exact QA deep link: hivedev://qa/corrupt-storage */
export const QA_CORRUPT_SCHEME = 'hivedev:';
export const QA_CORRUPT_HOST = 'qa';
export const QA_CORRUPT_PATHNAME = '/corrupt-storage';

/** Exact scheme, host, and path (RETURN-3 area 8) — parsed, never
 * substring-matched, so `https://evil/qa/corrupt-storage` and
 * `hivedev://qa/corrupt-storage-extra` never trigger the hook. */
export function isQaCorruptUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return (
    parsed.protocol === QA_CORRUPT_SCHEME &&
    parsed.hostname === QA_CORRUPT_HOST &&
    parsed.pathname === QA_CORRUPT_PATHNAME
  );
}

export async function corruptStoredSessionForQa(backend: SecureStoreBackend): Promise<void> {
  await backend.setItem(MANIFEST_KEY, `${QA_CORRUPT_HOOK_MARKER}:not-a-manifest`);
}
