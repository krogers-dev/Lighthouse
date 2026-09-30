/** HIVE_QA_SYNTHETIC_DOCUMENT_HOOK — development-only synthetic document
 * source (WO-003).
 *
 * The add-document device flow needs an executable way to put a file in
 * front of the app. The platform file picker (UIDocumentPicker, the
 * Storage Access Framework) is system UI outside the app's view
 * hierarchy, which Maestro drives poorly and differently per OS version.
 * So a QA build arms a NAMED SYNTHETIC source through one exact deep
 * link, and the next "Choose a file" resolves, once, to a small
 * synthetic PDF written into the app's cache: exactly what the system
 * picker would produce (a cache uri, a name, a size, a type), so the
 * reader, the digest, the transfer, and the discard are the production
 * code paths, and only the choosing is synthetic.
 *
 * Ship-safety, proven by gates rather than promised, as for every QA hook:
 *  - reachable only behind `__DEV__ && EXPO_PUBLIC_QA_HOOKS === '1'`
 *    (app/_layout.tsx); metro.config.js resolves this import to the inert
 *    stub unless QA hooks are enabled at build time, so the marker string
 *    `HIVE_QA_SYNTHETIC_DOCUMENT_HOOK` never enters a non-QA graph;
 *  - `bundle:inspect` proves that marker absent from every non-development
 *    export; `config:check` rejects EXPO_PUBLIC_QA_HOOKS outside development.
 * The armed state is one shot and memory-only; nothing is logged.
 */
import type { PickedDocument } from '@/features/documents/document-rules';
import type { DocumentSource } from '@/features/documents/ports';

export const QA_SYNTHETIC_DOCUMENT_MARKER = 'HIVE_QA_SYNTHETIC_DOCUMENT_HOOK';

/** The one exact QA deep link: hivedev:///?qa=synthetic-document
 *
 * Same shape law as the other QA links (find 24): root path, one query
 * parameter, exact value; parsed, never substring-matched. */
export const QA_SYNTHETIC_DOCUMENT_SCHEME = 'hivedev:';
export const QA_SYNTHETIC_DOCUMENT_PARAM = 'qa';
export const QA_SYNTHETIC_DOCUMENT_VALUE = 'synthetic-document';

export const SYNTHETIC_DOCUMENT_NAME = 'hive-qa-document (Synthetic).pdf';
export const SYNTHETIC_DOCUMENT_MIME = 'application/pdf';

/** A small, clearly synthetic PDF: one empty page and a comment naming
 * what it is. Enough for a PDF reader to open; no content from anywhere. */
const SYNTHETIC_PDF = [
  '%PDF-1.4',
  '% HIVE synthetic QA document (Synthetic). No real content.',
  '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
  '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
  '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] >> endobj',
  'trailer << /Root 1 0 R >>',
  '%%EOF',
  '',
].join('\n');

export function syntheticDocumentBytes(): Uint8Array {
  const out = new Uint8Array(SYNTHETIC_PDF.length);
  for (let i = 0; i < SYNTHETIC_PDF.length; i++) out[i] = SYNTHETIC_PDF.charCodeAt(i) & 0x7f;
  return out;
}

export function isQaSyntheticDocumentUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== QA_SYNTHETIC_DOCUMENT_SCHEME) return false;
  if (parsed.hostname !== '') return false;
  if (parsed.pathname !== '' && parsed.pathname !== '/') return false;
  const params = [...parsed.searchParams.entries()];
  if (params.length !== 1) return false;
  const [[name, value]] = params as [[string, string]];
  return name === QA_SYNTHETIC_DOCUMENT_PARAM && value === QA_SYNTHETIC_DOCUMENT_VALUE;
}

let armed = false;

/** Arm the synthetic source for exactly the next pick. */
export function armSyntheticDocument(): void {
  armed = true;
}

export function isSyntheticDocumentArmed(): boolean {
  return armed;
}

/** Disarm without picking (tests, and a reset between flows). */
export function disarmSyntheticDocument(): void {
  armed = false;
}

export type SyntheticDocumentWriter = (name: string, bytes: Uint8Array) => Promise<string>;

/** The real source, except that an armed QA build answers the next pick
 * with the synthetic PDF written into the cache. One shot: the flag is
 * cleared before the write, so a failure never re-arms itself. */
export function withSyntheticDocumentSource(
  real: DocumentSource,
  write: SyntheticDocumentWriter,
): DocumentSource {
  return {
    async pick(): Promise<PickedDocument | null> {
      if (!armed) return real.pick();
      armed = false;
      const bytes = syntheticDocumentBytes();
      const uri = await write(SYNTHETIC_DOCUMENT_NAME, bytes);
      return {
        uri,
        name: SYNTHETIC_DOCUMENT_NAME,
        byteSize: bytes.byteLength,
        mimeType: SYNTHETIC_DOCUMENT_MIME,
      };
    },
  };
}
