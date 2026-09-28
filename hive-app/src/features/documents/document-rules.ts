/** The rules a document must meet before a byte leaves the phone (WO-003).
 *
 * The server enforces every one of these again (constraints and the
 * begin_document_upload refusals); checking here first means a client
 * learns about a 25 MB file or a spreadsheet in the wrong format before
 * any transfer starts, not after. The limits are the provisional decisions
 * recorded in security/APPROVALS.md: 20 MB per file, four types, ten
 * documents per request, 30 days in quarantine.
 */

export const DOCUMENT_LIMITS = {
  maxBytes: 20 * 1024 * 1024,
  maxPerRequest: 10,
  quarantineRetentionDays: 30,
  transferWindowHours: 24,
  maxDisplayNameLength: 120,
} as const;

export const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'text/csv',
] as const;

export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

/** What the system picker hands back, before any rule is applied. Size and
 * type are what the platform reported and may be missing. */
export interface PickedDocument {
  readonly uri: string;
  readonly name: string;
  readonly byteSize: number | null;
  readonly mimeType: string | null;
}

/** A document that passed every local rule: bounded, typed, named. */
export interface CheckedDocument {
  readonly uri: string;
  readonly displayName: string;
  readonly byteSize: number;
  readonly mimeType: AllowedMimeType;
}

export type DocumentCheckRefusal = 'unsupported_type' | 'file_too_large' | 'empty_file';

export type DocumentCheck =
  | { readonly ok: true; readonly document: CheckedDocument }
  | { readonly ok: false; readonly refusal: DocumentCheckRefusal };

const EXTENSION_MIME: Record<string, AllowedMimeType> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  csv: 'text/csv',
};

/** Platform aliases that mean one of the approved types. */
const MIME_ALIASES: Record<string, AllowedMimeType> = {
  'image/jpg': 'image/jpeg',
  'image/pjpeg': 'image/jpeg',
  'text/comma-separated-values': 'text/csv',
  'application/csv': 'text/csv',
};

function isAllowedMimeType(value: string): value is AllowedMimeType {
  return (ALLOWED_MIME_TYPES as readonly string[]).includes(value);
}

/** The approved type for a picked document, or null when it is not one.
 *
 * The declared type wins when it is (or aliases) an approved type. Android
 * often reports `application/octet-stream` for a file the Storage Access
 * Framework cannot classify; then, and only then, the extension decides.
 * A declared type outside the allowlist that is NOT such a generic
 * placeholder is refused even if the extension looks right: a file that
 * calls itself something else is not one of the four. */
export function inferMimeType(name: string, declared: string | null): AllowedMimeType | null {
  const normalized = declared?.trim().toLowerCase().split(';')[0] ?? '';
  if (normalized !== '') {
    if (isAllowedMimeType(normalized)) return normalized;
    const alias = MIME_ALIASES[normalized];
    if (alias) return alias;
    if (normalized !== 'application/octet-stream' && normalized !== '*/*') return null;
  }
  const extension = /\.([A-Za-z0-9]+)$/.exec(name.trim())?.[1]?.toLowerCase() ?? '';
  return EXTENSION_MIME[extension] ?? null;
}

/** A printable, bounded name to show on the request. Control characters
 * never reach a screen or a row; an empty result gets a neutral label. */
export function sanitizeDisplayName(name: string): string {
  const cleaned = Array.from(name)
    .filter((char) => {
      const code = char.codePointAt(0) ?? 0;
      return code >= 0x20 && code !== 0x7f && !(code >= 0x80 && code <= 0x9f);
    })
    .join('')
    .trim();
  const bounded = Array.from(cleaned).slice(0, DOCUMENT_LIMITS.maxDisplayNameLength).join('');
  return bounded === '' ? 'Document' : bounded;
}

/** Apply every local rule to a picked document. */
export function checkPickedDocument(picked: PickedDocument): DocumentCheck {
  const mimeType = inferMimeType(picked.name, picked.mimeType);
  if (mimeType === null) return { ok: false, refusal: 'unsupported_type' };
  const byteSize = picked.byteSize;
  if (byteSize === null || !Number.isFinite(byteSize) || byteSize <= 0) {
    return { ok: false, refusal: 'empty_file' };
  }
  if (byteSize > DOCUMENT_LIMITS.maxBytes) return { ok: false, refusal: 'file_too_large' };
  return {
    ok: true,
    document: {
      uri: picked.uri,
      displayName: sanitizeDisplayName(picked.name),
      byteSize,
      mimeType,
    },
  };
}

/** Human-readable size, to one decimal above a kilobyte. */
export function formatByteSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${Math.round(bytes)} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Whether a request can take another document under the cap. */
export function canAddAnotherDocument(liveDocumentCount: number): boolean {
  return liveDocumentCount < DOCUMENT_LIMITS.maxPerRequest;
}
