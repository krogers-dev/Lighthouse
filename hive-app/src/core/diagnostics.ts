/** Privacy-minimized diagnostics interface.
 *
 * The only sanctioned path for observability signals. Field names are
 * allowlisted; values are scanned and redacted if they resemble anything on
 * the excluded list (credentials, tokens, emails, URLs, identifiers). No
 * analytics or crash SDK sits behind this in Milestone 0 — the default sink
 * is inert — but every caller is already constrained to the contract, so a
 * future sink cannot widen what leaves the app.
 */

export const DIAGNOSTIC_EVENT_NAMES = [
  'auth_transition',
  'auth_illegal_transition',
  'auth_epoch_stale_event',
  'storage_quarantine_entered',
  'storage_scrub_result',
  'storage_write_result',
  'reinstall_purge',
  'scope_cleared',
  'env_validation_failed',
  'repository_denied',
  'error_boundary_fatal',
] as const;

export type DiagnosticEventName = (typeof DIAGNOSTIC_EVENT_NAMES)[number];

export const ALLOWED_FIELD_NAMES = [
  'fromState',
  'toState',
  'event',
  'code',
  'reason',
  'outcome',
  'count',
  'durationMs',
  'variant',
] as const;

export type AllowedFieldName = (typeof ALLOWED_FIELD_NAMES)[number];

export type DiagnosticFields = Partial<Record<AllowedFieldName, string | number | boolean>>;

export interface Diagnostics {
  record(name: DiagnosticEventName, fields?: DiagnosticFields): void;
}

export interface DiagnosticSink {
  write(name: DiagnosticEventName, fields: Record<string, string | number | boolean>): void;
}

const REDACT_PATTERNS: RegExp[] = [
  /eyJ[A-Za-z0-9_-]{8,}/, // JWT-shaped
  /sb_(publishable|secret)_[A-Za-z0-9_-]+/,
  /service_role/i,
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i, // UUID identifiers
  /[^\s@]+@[^\s@]+\.[^\s@]+/, // email addresses
  /https?:\/\//i, // URLs
  /-----BEGIN/, // key material
];

const MAX_STRING_LENGTH = 64;

export function sanitizeFieldValue(value: string | number | boolean): string | number | boolean {
  if (typeof value !== 'string') return value;
  if (REDACT_PATTERNS.some((p) => p.test(value))) return '[redacted]';
  if (value.length > MAX_STRING_LENGTH) return `${value.slice(0, MAX_STRING_LENGTH)}…`;
  return value;
}

export function createDiagnostics(sink: DiagnosticSink): Diagnostics {
  const allowedNames = new Set<string>(DIAGNOSTIC_EVENT_NAMES);
  const allowedFields = new Set<string>(ALLOWED_FIELD_NAMES);
  return {
    record(name, fields) {
      if (!allowedNames.has(name)) return;
      const clean: Record<string, string | number | boolean> = {};
      if (fields) {
        for (const [key, value] of Object.entries(fields)) {
          if (!allowedFields.has(key) || value === undefined) continue;
          clean[key] = sanitizeFieldValue(value);
        }
      }
      sink.write(name, clean);
    },
  };
}

/** Milestone 0 default: no analytics/crash SDK, no output. */
export const nullDiagnostics: Diagnostics = {
  record() {
    // intentionally inert
  },
};
