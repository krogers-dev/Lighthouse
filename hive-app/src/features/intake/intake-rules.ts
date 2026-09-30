/** The rules of intake as the screens apply them (WO-013, Milestone 7).
 *
 * What a case title and a request must look like before any round trip,
 * and the due dates a request may carry. Everything here is restated from
 * the server's functions, which decide for real. The bounds are the
 * provisional decisions recorded in security/APPROVALS.md.
 */
import { codePointLength, stripControlCharacters } from '@/core/text';
import type { DocumentSummary } from '@/data/supabase/documents';
import type { CaseStatus } from '@/data/supabase/repositories';
import type { MembershipRole } from '@/tenancy/types';

export const TITLE_LIMITS = { minLength: 2, maxLength: 120 } as const;
export const DETAIL_LIMITS = { maxLength: 2000 } as const;

/** The due dates a request may carry: none, or a fixed number of days
 * from today by the server's clock. A date typed by hand is a mistake
 * waiting to happen on a phone; four choices are not. */
export const DUE_CHOICES = [null, 7, 14, 30] as const;
export type DueChoice = (typeof DUE_CHOICES)[number];

export function dueChoiceLabel(choice: DueChoice): string {
  if (choice === null) return 'No due date';
  return `In ${choice} days`;
}

/** Who may open a case: intake, on a workspace they hold that role in. */
export function canOpenCase(role: MembershipRole | null): boolean {
  return role === 'intake';
}

/** Who may ask the client for something, and when: intake or the preparer,
 * once intake is recorded and while evidence is being gathered. */
export function canAskOnCase(role: MembershipRole | null, status: CaseStatus | null): boolean {
  return (
    (role === 'intake' || role === 'preparer') &&
    (status === 'INTAKE_RECORDED' || status === 'EVIDENCE_PENDING')
  );
}

/** A title is one line: control characters and line breaks are removed
 * before any round trip, then it is trimmed and single-spaced. */
export function sanitizeTitle(text: string): string {
  return stripControlCharacters(text).replace(/[\n\t]/g, ' ');
}

export function cleanTitle(text: string): string {
  return sanitizeTitle(text).replace(/ {2,}/g, ' ').trim();
}

export function sanitizeDetail(text: string): string {
  return stripControlCharacters(text);
}

export type TitleRefusal = 'title_missing' | 'title_too_long';
export type DetailRefusal = 'detail_too_long';
export type IntakeLocalRefusal = TitleRefusal | DetailRefusal;

export type TitleCheck =
  | { readonly ok: true; readonly title: string }
  | { readonly ok: false; readonly refusal: TitleRefusal };

export function checkTitle(text: string): TitleCheck {
  const title = cleanTitle(text);
  if (codePointLength(title) < TITLE_LIMITS.minLength)
    return { ok: false, refusal: 'title_missing' };
  if (codePointLength(title) > TITLE_LIMITS.maxLength)
    return { ok: false, refusal: 'title_too_long' };
  return { ok: true, title };
}

export type DetailCheck =
  | { readonly ok: true; readonly detail: string }
  | { readonly ok: false; readonly refusal: DetailRefusal };

/** A detail may be blank; it may not exceed the bound. */
export function checkDetail(text: string): DetailCheck {
  const detail = sanitizeDetail(text).trim();
  if (codePointLength(detail) > DETAIL_LIMITS.maxLength)
    return { ok: false, refusal: 'detail_too_long' };
  return { ok: true, detail };
}

export function titleLength(text: string): number {
  return codePointLength(cleanTitle(text));
}

export function detailLength(text: string): number {
  return codePointLength(sanitizeDetail(text));
}

/** The documents a question may be about: checked ones of the case. */
export function subjectDocuments(documents: readonly DocumentSummary[]): DocumentSummary[] {
  return documents.filter((document) => document.status === 'ACCEPTED');
}

export interface CaseDraft {
  readonly title: string;
}

export interface RequestDraft {
  readonly title: string;
  readonly detail: string;
  readonly dueInDays: DueChoice;
  readonly subjectDocumentId: string | null;
}

export const initialCaseDraft: CaseDraft = { title: '' };

export const initialRequestDraft: RequestDraft = {
  title: '',
  detail: '',
  dueInDays: null,
  subjectDocumentId: null,
};
