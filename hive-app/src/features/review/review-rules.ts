/** The rules of the case workflow as the screen applies them (WO-005).
 *
 * Which ONE action a role may take on a case in its current status, and
 * which verdicts a role may record. Everything here is restated from the
 * server's transitions, which decide for real; conflicts of interest are
 * the server's alone to refuse (the screen cannot know who froze or
 * reviewed a package, and does not need to). The note bound is the
 * provisional decision recorded in security/APPROVALS.md.
 */
import { codePointLength, stripControlCharacters } from '@/core/text';
import type { CaseStatus } from '@/data/supabase/repositories';
import type { ReviewVerdict } from '@/data/supabase/reviews';
import type { MembershipRole } from '@/tenancy/types';

export type CaseAction = 'freeze' | 'start_review' | 'record_verdict' | 'approve' | 'resume';

export const NOTE_LIMITS = { maxLength: 2000 } as const;

/** The only destination an approval may name in this milestone: the HIVE
 * workflow record itself. Anything external is its own approval. */
export const APPROVAL_DESTINATION = 'hive-record';

/** The actions a role may take on a case in this status. At most two,
 * and then one of them is the verdict beside the approval. */
export function actionsFor(
  role: MembershipRole | null,
  status: CaseStatus | null,
): readonly CaseAction[] {
  if (!role || !status) return [];
  switch (role) {
    case 'preparer':
      if (status === 'EVIDENCE_PENDING') return ['freeze'];
      if (status === 'RETURNED' || status === 'APPROVED') return ['resume'];
      return [];
    case 'reviewer':
      if (status === 'READY_FOR_REVIEW') return ['start_review'];
      if (status === 'IN_REVIEW') return ['record_verdict'];
      return [];
    case 'approver':
      if (status === 'APPROVAL_PENDING') return ['approve', 'record_verdict'];
      if (status === 'HOLD') return ['resume'];
      return [];
    default:
      return [];
  }
}

/** The verdicts a role may record: a reviewer any of the three, an
 * approver only the two that stop a passed package (their PASS is the
 * approval itself). */
export function verdictsFor(role: MembershipRole | null): readonly ReviewVerdict[] {
  if (role === 'reviewer') return ['PASS', 'RETURN', 'HOLD'];
  if (role === 'approver') return ['RETURN', 'HOLD'];
  return [];
}

export type NoteCheck =
  | { readonly ok: true; readonly note: string }
  | { readonly ok: false; readonly refusal: 'note_too_long' };

/** A note may be blank; it may not exceed the bound. Control characters
 * are removed before any round trip. */
export function checkNote(text: string): NoteCheck {
  const note = stripControlCharacters(text);
  if (codePointLength(note) > NOTE_LIMITS.maxLength) return { ok: false, refusal: 'note_too_long' };
  return { ok: true, note };
}

export function sanitizeNote(text: string): string {
  return stripControlCharacters(text);
}

export function noteLength(text: string): number {
  return codePointLength(text);
}
