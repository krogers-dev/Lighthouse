/** Inert stand-in for the QA synthetic-document source. metro.config.js
 * resolves `@/dev/qa-synthetic-document` to THIS file whenever
 * EXPO_PUBLIC_QA_HOOKS is not '1' at build time, so the real module and
 * its provable marker string never enter the dependency graph of a non-QA
 * bundle. This stub carries no marker, arms nothing, and hands the real
 * picker straight through. */
import type { DocumentSource } from '@/features/documents/ports';

export const QA_SYNTHETIC_DOCUMENT_MARKER = '';
export const QA_SYNTHETIC_DOCUMENT_SCHEME = '';
export const QA_SYNTHETIC_DOCUMENT_PARAM = '';
export const QA_SYNTHETIC_DOCUMENT_VALUE = '';
export const SYNTHETIC_DOCUMENT_NAME = '';
export const SYNTHETIC_DOCUMENT_MIME = '';

export type SyntheticDocumentWriter = (name: string, bytes: Uint8Array) => Promise<string>;

export function syntheticDocumentBytes(): Uint8Array {
  return new Uint8Array(0);
}

export function isQaSyntheticDocumentUrl(_url: string): boolean {
  return false;
}

export function armSyntheticDocument(): void {
  // Intentionally inert: QA hooks are not compiled into this build.
}

export function isSyntheticDocumentArmed(): boolean {
  return false;
}

export function disarmSyntheticDocument(): void {
  // Intentionally inert.
}

export function withSyntheticDocumentSource(
  real: DocumentSource,
  _write: SyntheticDocumentWriter,
): DocumentSource {
  return real;
}
