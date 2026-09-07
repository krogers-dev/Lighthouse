/** Inert stand-in for the QA session-expiry hook. metro.config.js
 * resolves `@/dev/qa-expire-session` to THIS file whenever
 * EXPO_PUBLIC_QA_HOOKS is not '1' at build time, so the real module —
 * and its provable marker string — never enters the dependency graph of
 * a non-QA bundle. (Metro registers require() dependencies before
 * dead-code elimination, so a source-level __DEV__ guard alone still
 * bundles the module; the RETURN-3 candidate inspection lane caught
 * exactly that.) This stub carries no marker and does nothing. */
import type { SecureStoreBackend } from '@/auth/secure-store-adapter';

export const QA_EXPIRE_HOOK_MARKER = '';
export const QA_EXPIRE_SCHEME = '';
export const QA_EXPIRE_PARAM = '';
export const QA_EXPIRE_VALUE = '';
export const QA_EXPIRE_QUIESCE_MS = 0;

export function isQaExpireUrl(_url: string): boolean {
  return false;
}

export function expireSessionEnvelope(_raw: string): string | null {
  return null;
}

export async function expireStoredSessionForQa(
  _backend: SecureStoreBackend,
  _quiesce?: () => Promise<void>,
): Promise<boolean> {
  // Intentionally inert: QA hooks are not compiled into this build.
  return false;
}
