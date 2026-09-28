/** Client-facing wording and formatting, in one place.
 *
 * Relationship language is Stacie's to own (WO-002 D4). Everything here is
 * plain, non-committal placeholder wording chosen so the screens are
 * readable and testable now; it is expected to be replaced wholesale
 * without touching a screen, a query, or a migration. That is exactly why
 * activity is stored as enumerated kinds rather than sentences: changing
 * the words below changes the app, and nothing else.
 */
import type { AnswerStatus } from '@/data/supabase/answers';
import type { DocumentStatus } from '@/data/supabase/documents';
import type {
  ActivityActorRole,
  ActivityEventKind,
  CaseStatus,
  RequestStatus,
} from '@/data/supabase/repositories';
import type { AnswerFlowRefusal } from '@/features/answers/answer-flow';
import type { AddDocumentRefusal } from '@/features/documents/add-document-flow';
import type { MembershipRole } from '@/tenancy/types';
import type { StatusKind } from '@/ui/primitives/StatusBadge';

export const OWNER_LABEL: Record<MembershipRole, string> = {
  client_user: 'You',
  intake: 'Honeybee team',
  preparer: 'Your preparer',
  reviewer: 'Honeybee reviewer',
  approver: 'Honeybee approver',
};

/** Activity never names a person, only the acting role (threat T3). */
export const ACTOR_LABEL: Record<ActivityActorRole, string> = {
  ...OWNER_LABEL,
  system: 'HIVE',
};

/** Case status in client language: never the raw enum, never
 * accounting-software wording. */
export const CASE_STATUS_PRESENTATION: Record<CaseStatus, { kind: StatusKind; label: string }> = {
  DRAFT: { kind: 'neutral', label: 'Being set up' },
  INTAKE_RECORDED: { kind: 'neutral', label: 'Received' },
  EVIDENCE_PENDING: { kind: 'attention', label: 'Waiting on documents' },
  READY_FOR_REVIEW: { kind: 'neutral', label: 'Ready for review' },
  IN_REVIEW: { kind: 'neutral', label: 'In review' },
  APPROVAL_PENDING: { kind: 'neutral', label: 'Awaiting approval' },
  APPROVED: { kind: 'stable', label: 'Approved' },
  RETURNED: { kind: 'attention', label: 'Returned for changes' },
  HOLD: { kind: 'blocked', label: 'On hold' },
};

export const REQUEST_STATUS_PRESENTATION: Record<
  RequestStatus,
  { kind: StatusKind; label: string }
> = {
  OPEN: { kind: 'attention', label: 'Needs a response' },
  ANSWERED: { kind: 'neutral', label: 'Answered' },
  CLOSED: { kind: 'stable', label: 'Closed' },
  // "Expired" is the familiar word for a request whose time ran out; it is
  // a fact about the request, not a block on the client, so it carries the
  // plain status prefix (2026-09-07 wording review). What makes a request
  // expire is the workflow's to define.
  EXPIRED: { kind: 'neutral', label: 'Expired' },
};

export const ACTIVITY_KIND_LABEL: Record<ActivityEventKind, string> = {
  'case.status_changed': 'Status changed',
  'request.opened': 'Request opened',
  'request.answered': 'Request answered',
  'request.closed': 'Request closed',
  'request.expired': 'Request expired',
  'document.received': 'Document received',
  'document.checked': 'Document checked',
  'document.not_accepted': 'Document not accepted',
  'document.expired': 'Document expired',
};

/** Why a document was not taken, in client language (WO-003). Every
 * server refusal token has an entry, so no refusal ever reaches a person
 * as a code. What to do next is part of each one. */
export const DOCUMENT_REFUSAL_WORDING: Record<AddDocumentRefusal, { title: string; body: string }> =
  {
    unsupported_type: {
      title: 'That file type is not accepted',
      body: 'HIVE takes PDF, PNG, JPEG and CSV files. Choose a different file.',
    },
    file_too_large: {
      title: 'That file is too large',
      body: 'Each file can be up to 20 MB. Choose a smaller file.',
    },
    empty_file: {
      title: 'That file is empty',
      body: 'Choose a file that has content.',
    },
    request_not_found: {
      title: 'Request not found here',
      body: 'This request is not part of the workspace you are viewing.',
    },
    request_closed: {
      title: 'This request is no longer taking documents',
      body: 'It has been answered or closed. Go back to the request to see its current status.',
    },
    request_changed: {
      title: 'This request changed while you were here',
      body: 'Go back to the request, refresh it, and try again.',
    },
    invalid_digest: {
      title: 'The file could not be prepared',
      body: 'Choose the file again.',
    },
    invalid_name: {
      title: 'The file name could not be used',
      body: 'Choose the file again.',
    },
    invalid_idempotency_key: {
      title: 'The file could not be prepared',
      body: 'Choose the file again.',
    },
    too_many_documents: {
      title: 'This request has all the documents it can take',
      body: 'Up to ten documents can be added to one request. Contact your Honeybee team if more are needed.',
    },
    transfer_incomplete: {
      title: 'The transfer did not complete',
      body: 'Nothing was received yet. Send it again.',
    },
    transfer_expired: {
      title: 'The transfer took too long',
      body: 'Choose the file again and send it.',
    },
    size_mismatch: {
      title: 'The file did not transfer completely',
      body: 'Choose the file again and send it.',
    },
  };

/** A document's state on its request, in client language (WO-003).
 * Nothing here says approved, filed, or final: a checked document is a
 * HIVE evidence reference, and Google Drive stays the permanent record. */
export const DOCUMENT_STATUS_PRESENTATION: Record<
  DocumentStatus,
  { kind: StatusKind; label: string }
> = {
  QUARANTINED: { kind: 'neutral', label: 'Received, being checked' },
  VALIDATING: { kind: 'neutral', label: 'Received, being checked' },
  ACCEPTED: { kind: 'stable', label: 'Checked' },
  REJECTED: { kind: 'attention', label: 'Not accepted' },
  EXPIRED: { kind: 'neutral', label: 'Expired' },
};

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/** Format a server `date` column (YYYY-MM-DD).
 *
 * Parsed by parts rather than through Date: `new Date('2026-08-10')` is
 * parsed as UTC midnight and then rendered in the device's zone, which
 * shows the previous day west of Greenwich. A date the server recorded
 * must not shift because of where the phone is. */
export function formatServerDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return value;
  const [, year, month, day] = match;
  const monthName = MONTHS[Number(month) - 1];
  if (!monthName) return value;
  return `${monthName} ${Number(day)}, ${year}`;
}

/** Format a server timestamptz for display, to the day.
 *
 * Milestone 1 shows the date only. A time-of-day rendered in the device's
 * zone invites "that is not when it happened" from a client in another
 * zone, and nothing in this read surface needs the hour. */
export function formatServerTimestamp(value: string): string {
  return formatServerDate(value);
}

/** The truthful staleness line (R7 / threat T4).
 *
 * States what the information is recorded THROUGH — the newest server
 * timestamp actually present — never a device-clock reading dressed up as
 * "as of". Returns null when there is nothing to be current about, so the
 * caller renders no claim at all. */
export function recordedThroughLabel(recordedThrough: string | null): string | null {
  if (!recordedThrough) return null;
  return `Recorded through ${formatServerTimestamp(recordedThrough)}`;
}

/** Why an answer was not taken, in client language (WO-004). Every server
 * refusal token has an entry, so no refusal ever reaches a person as a
 * code. What to do next is part of each one. */
export const ANSWER_REFUSAL_WORDING: Record<AnswerFlowRefusal, { title: string; body: string }> = {
  request_not_found: {
    title: 'Request not found here',
    body: 'This request is not part of the workspace you are viewing.',
  },
  request_closed: {
    title: 'This request is no longer taking an answer',
    body: 'It has been answered or closed. Go back to the request to see its current status.',
  },
  request_changed: {
    title: 'This request changed while you were here',
    body: 'Go back to the request, refresh it, and continue from there. Your text is still on this screen.',
  },
  invalid_text: {
    title: 'Part of the text could not be used',
    body: 'Remove any unusual characters and try again.',
  },
  answer_too_long: {
    title: 'The answer is too long',
    body: 'Up to 4,000 characters can be submitted. Shorten it and try again.',
  },
  too_many_citations: {
    title: 'Too many documents are referred to',
    body: 'Up to 20 documents can be referred to in one answer. Remove some and try again.',
  },
  invalid_document: {
    title: 'A document can no longer be referred to',
    body: 'One of the documents you referred to is no longer on this request, or was not accepted. Remove it and try again.',
  },
  already_submitted: {
    title: 'This request has already been answered',
    body: 'An answer was submitted, and a submitted answer cannot be changed. Go back to the request to see it.',
  },
  answer_changed: {
    title: 'This draft changed elsewhere',
    body: 'It was saved from another device or by someone else in your workspace. Go back to the request and continue from the latest draft. Your text is still on this screen.',
  },
  empty_answer: {
    title: 'The answer is empty',
    body: 'Write your answer before submitting it.',
  },
  invalid_idempotency_key: {
    title: 'The answer could not be prepared',
    body: 'Try again.',
  },
};

/** An answer's state on its request, in client language (WO-004). */
export const ANSWER_STATUS_PRESENTATION: Record<AnswerStatus, { kind: StatusKind; label: string }> =
  {
    DRAFT: { kind: 'neutral', label: 'Draft, not submitted' },
    SUBMITTED: { kind: 'stable', label: 'Submitted' },
  };
