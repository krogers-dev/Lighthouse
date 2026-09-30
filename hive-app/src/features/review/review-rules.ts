/** The rules of the case workflow as the screen applies them (WO-005,
 * WO-006).
 *
 * Which ONE action a role may take on a case in its current status,
 * which verdicts a role may record, and what a filing receipt must name.
 * Everything here is restated from the server's transitions, which
 * decide for real; conflicts of interest and the approval's coverage of
 * a document are the server's alone to refuse. The bounds are the
 * provisional decisions recorded in security/APPROVALS.md.
 */
import { codePointLength, stripControlCharacters } from '@/core/text';
import type { DocumentSummary } from '@/data/supabase/documents';
import type { CaseStatus, RequestStatus } from '@/data/supabase/repositories';
import type { ReviewVerdict } from '@/data/supabase/reviews';
import type { MembershipRole } from '@/tenancy/types';

export type CaseAction =
  | 'freeze'
  | 'start_review'
  | 'record_verdict'
  | 'approve'
  | 'resume'
  | 'record_filing'
  // Intake (WO-013): the draft recorded or discarded, a request asked for
  // (a screen of its own, not a transition here), a request closed.
  | 'record_intake'
  | 'discard_draft'
  | 'add_request'
  | 'close_request';

/** The one action that opens a screen instead of a confirmation. */
export function isNavigationAction(action: CaseAction): boolean {
  return action === 'add_request';
}

export const NOTE_LIMITS = { maxLength: 2000 } as const;

/** The only destination an approval may name in this milestone: the HIVE
 * workflow record itself. Anything external is its own approval. */
export const APPROVAL_DESTINATION = 'hive-record';

export const FILING_LIMITS = {
  fileIdPattern: /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/,
  pathMaxLength: 240,
} as const;

/** The actions a role may take on a case in this status. At most two,
 * the first the primary. */
export function actionsFor(
  role: MembershipRole | null,
  status: CaseStatus | null,
): readonly CaseAction[] {
  if (!role || !status) return [];
  switch (role) {
    case 'intake':
      if (status === 'DRAFT') return ['record_intake', 'discard_draft'];
      if (status === 'INTAKE_RECORDED' || status === 'EVIDENCE_PENDING') return ['add_request'];
      if (status === 'APPROVED') return ['record_filing'];
      return [];
    case 'preparer':
      if (status === 'EVIDENCE_PENDING') return ['freeze', 'add_request'];
      if (status === 'RETURNED') return ['resume'];
      if (status === 'APPROVED') return ['record_filing', 'resume'];
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

export type RequestAction = 'close_request';

/** What a role may do to one request of the case (WO-013): intake or the
 * preparer closes an open or answered one. */
export function requestActionsFor(
  role: MembershipRole | null,
  status: RequestStatus | null,
): readonly RequestAction[] {
  if ((role === 'intake' || role === 'preparer') && (status === 'OPEN' || status === 'ANSWERED')) {
    return ['close_request'];
  }
  return [];
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

/** The documents a filing receipt may name: checked ones. Whether the
 * approval covers them is the server's to decide. */
export function filableDocuments(documents: readonly DocumentSummary[]): DocumentSummary[] {
  return documents.filter((document) => document.status === 'ACCEPTED');
}

export interface FilingDraft {
  readonly documentId: string | null;
  readonly driveFileId: string;
  readonly drivePath: string;
}

export type FilingRefusal = 'document_missing' | 'invalid_file_id' | 'invalid_path';

export type FilingCheck =
  | {
      readonly ok: true;
      readonly documentId: string;
      readonly driveFileId: string;
      readonly drivePath: string;
    }
  | { readonly ok: false; readonly refusal: FilingRefusal };

/** What a receipt must name before any round trip: a document, a Drive
 * file id in its shape, and a bounded printable path. */
export function checkFiling(draft: FilingDraft): FilingCheck {
  if (!draft.documentId) return { ok: false, refusal: 'document_missing' };
  const driveFileId = draft.driveFileId.trim();
  if (!FILING_LIMITS.fileIdPattern.test(driveFileId))
    return { ok: false, refusal: 'invalid_file_id' };
  const drivePath = stripControlCharacters(draft.drivePath).trim();
  if (drivePath.length === 0 || codePointLength(drivePath) > FILING_LIMITS.pathMaxLength) {
    return { ok: false, refusal: 'invalid_path' };
  }
  return { ok: true, documentId: draft.documentId, driveFileId, drivePath };
}
