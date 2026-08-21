/** Inert stand-in for the QA storage-corruption hook. metro.config.js
 * resolves `@/dev/qa-corrupt-storage` to THIS file whenever
 * EXPO_PUBLIC_QA_HOOKS is not '1' at build time, so the real module —
 * and its provable marker string — never enters the dependency graph of
 * a non-QA bundle. (Metro registers require() dependencies before
 * dead-code elimination, so a source-level __DEV__ guard alone still
 * bundles the module; the RETURN-3 candidate inspection lane caught
 * exactly that.) This stub carries no marker and does nothing. */
import type { SecureStoreBackend } from '@/auth/secure-store-adapter';

export const QA_CORRUPT_HOOK_MARKER = '';
export const QA_CORRUPT_SCHEME = '';
export const QA_CORRUPT_HOST = '';
export const QA_CORRUPT_PATHNAME = '';

export function isQaCorruptUrl(_url: string): boolean {
  return false;
}

export async function corruptStoredSessionForQa(_backend: SecureStoreBackend): Promise<void> {
  // Intentionally inert: QA hooks are not compiled into this build.
}
