/** The rules an answer must meet before it leaves the phone (WO-004).
 *
 * The server enforces every one of these again (the table constraint and
 * the save/submit refusals); checking here first means a person learns
 * about a blank or over-long answer before any round trip, not after.
 * The limits are the provisional decisions recorded in
 * security/APPROVALS.md: 4,000 characters, twenty cited documents.
 */
import { codePointLength, formatCount, stripControlCharacters } from '@/core/text';
import type { RequestAnswer } from '@/data/supabase/answers';
import type { DocumentSummary } from '@/data/supabase/documents';
import type { RequestDetail } from '@/data/supabase/repositories';
import type { MembershipRole } from '@/tenancy/types';

export const ANSWER_LIMITS = {
  maxLength: 4000,
  maxCitations: 20,
} as const;

/** Text the server would refuse as a control character: everything below
 * space except newline and tab, and DEL. Removed rather than refused:
 * none of it is visible, so nothing a person wrote is lost. */
export function sanitizeAnswerText(text: string): string {
  return stripControlCharacters(text);
}

/** Characters as the server counts them (code points, not UTF-16 units). */
export function answerLength(text: string): number {
  return codePointLength(text);
}

export type AnswerTextRefusal = 'empty_answer' | 'answer_too_long';

export type AnswerTextCheck =
  | { readonly ok: true; readonly body: string }
  | { readonly ok: false; readonly refusal: AnswerTextRefusal };

/** Whether the text can be submitted. A draft may be blank; a submission
 * may not, and the server holds the same line (empty_answer). */
export function checkAnswerText(text: string): AnswerTextCheck {
  const body = sanitizeAnswerText(text);
  if (body.trim() === '') return { ok: false, refusal: 'empty_answer' };
  if (answerLength(body) > ANSWER_LIMITS.maxLength) {
    return { ok: false, refusal: 'answer_too_long' };
  }
  return { ok: true, body };
}

/** The documents an answer may refer to: received on this request and
 * not refused or expired, the server's citable set restated. */
export function citableDocuments(documents: readonly DocumentSummary[]): DocumentSummary[] {
  return documents.filter(
    (document) =>
      document.status === 'QUARANTINED' ||
      document.status === 'VALIDATING' ||
      document.status === 'ACCEPTED',
  );
}

/** The one rule for the answer control (WO-004): a client user, an open
 * request, and no submitted answer. Staff never see the control; a
 * submitted answer is read, never rewritten. */
export function canAnswer(
  role: MembershipRole | null,
  request: RequestDetail | null,
  answer: RequestAnswer | null,
): boolean {
  return (
    role === 'client_user' &&
    request !== null &&
    request.status === 'OPEN' &&
    (answer === null || answer.status === 'DRAFT')
  );
}

export { formatCount };
