/** Client-facing wording and formatting, in one place.
 *
 * Relationship language is Stacie's to own (WO-002 D4). Everything here is
 * plain, non-committal placeholder wording chosen so the screens are
 * readable and testable now; it is expected to be replaced wholesale
 * without touching a screen, a query, or a migration. That is exactly why
 * activity is stored as enumerated kinds rather than sentences: changing
 * the words below changes the app, and nothing else.
 */
import type { ServiceReason } from '@/core/service-status';
import type { AccountRefusal } from '@/data/supabase/account';
import type { AnswerStatus } from '@/data/supabase/answers';
import type { DocumentStatus } from '@/data/supabase/documents';
import type {
  ApprovalStatus,
  FilingStatus,
  ReviewRole,
  ReviewVerdict,
} from '@/data/supabase/reviews';
import type {
  ActivityActorRole,
  ActivityEventKind,
  CaseStatus,
  RequestStatus,
} from '@/data/supabase/repositories';
import type { AnswerFlowRefusal } from '@/features/answers/answer-flow';
import type { AddDocumentRefusal } from '@/features/documents/add-document-flow';
import type { ReviewFlowRefusal } from '@/features/review/review-flow';
import type { CaseAction } from '@/features/review/review-rules';
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
  // The case workflow (WO-005): what the trail says about review and
  // approval, in client language, never a person or a note.
  'case.package_frozen': 'Sent for review',
  'case.review_started': 'Review started',
  'case.review_passed': 'Review passed',
  'case.returned': 'Returned for changes',
  'case.held': 'Put on hold',
  'case.approved': 'Approved',
  'case.resumed': 'Work resumed',
  'case.approval_expired': 'Approval expired',
  // The sources (WO-006): a ledger object referenced, a document filed to
  // the permanent record by hand, and the read-only check of that filing.
  'source.referenced': 'Source referenced',
  'record.filed': 'Filed to the record',
  'record.verified': 'Filing verified',
  'record.mismatch': 'Filing did not match',
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

/** The case workflow for staff (WO-005): verdicts, roles, approvals. */
export const VERDICT_PRESENTATION: Record<ReviewVerdict, { kind: StatusKind; label: string }> = {
  PASS: { kind: 'stable', label: 'Pass' },
  RETURN: { kind: 'attention', label: 'Return' },
  HOLD: { kind: 'blocked', label: 'Hold' },
};

export const REVIEW_ROLE_LABEL: Record<ReviewRole, string> = {
  reviewer: 'Reviewer',
  approver: 'Approver',
};

export const APPROVAL_STATUS_PRESENTATION: Record<
  ApprovalStatus,
  { kind: StatusKind; label: string }
> = {
  ACTIVE: { kind: 'stable', label: 'Active approval' },
  EXPIRED: { kind: 'neutral', label: 'Expired approval' },
  SUPERSEDED: { kind: 'neutral', label: 'Superseded approval' },
};

export const APPROVAL_END_REASON_LABEL: Record<string, string> = {
  expired: 'It expired.',
  package_superseded: 'A newer package superseded it.',
  case_reopened: 'The case was reopened for changes.',
};

export const DESTINATION_LABEL: Record<string, string> = {
  'hive-record': 'the HIVE record',
};

/** The one action, named for the status it acts on. */
export function caseActionLabel(action: CaseAction, status: CaseStatus): string {
  switch (action) {
    case 'freeze':
      return 'Send for review';
    case 'start_review':
      return 'Start review';
    case 'record_verdict':
      return 'Record verdict';
    case 'approve':
      return 'Approve this package';
    case 'resume':
      if (status === 'HOLD') return 'Lift the hold';
      if (status === 'APPROVED') return 'Reopen for changes';
      return 'Resume work';
    case 'record_filing':
      return 'Record filing receipt';
  }
}

/** Why a case transition was not taken, in staff language (WO-005). Every
 * server token has an entry; a stale screen is sent to refresh. */
export const REVIEW_REFUSAL_WORDING: Record<ReviewFlowRefusal, { title: string; body: string }> = {
  case_not_found: {
    title: 'Case not found here',
    body: 'This case is not part of the workspace you are viewing.',
  },
  case_changed: {
    title: 'This case changed while you were here',
    body: 'Refresh the case and look again before acting.',
  },
  case_not_freezable: {
    title: 'This case cannot be sent for review right now',
    body: 'Refresh the case to see its current status.',
  },
  case_not_reviewable: {
    title: 'This case is not ready for that',
    body: 'Refresh the case to see its current status.',
  },
  package_missing: {
    title: 'There is no package to act on',
    body: 'Refresh the case; it may need to be sent for review again.',
  },
  conflict_of_interest: {
    title: 'You cannot take this step on this case',
    body: 'The person who froze or reviewed a package does not review or approve it. Another conflict-free colleague takes this step.',
  },
  review_in_progress: {
    title: 'Another reviewer already started',
    body: 'Refresh the case to see the review under way.',
  },
  not_your_review: {
    title: 'This review belongs to someone else',
    body: 'Only the reviewer who started it records its verdict.',
  },
  invalid_verdict: {
    title: 'That verdict is not available here',
    body: 'Choose one of the verdicts offered and try again.',
  },
  note_too_long: {
    title: 'The note is too long',
    body: 'Up to 2,000 characters can be recorded. Shorten it and try again.',
  },
  invalid_text: {
    title: 'Part of the note could not be used',
    body: 'Remove any unusual characters and try again.',
  },
  case_not_resumable: {
    title: 'Work cannot be resumed from here',
    body: 'Refresh the case to see its current status.',
  },
  case_not_approvable: {
    title: 'This case is not waiting for approval',
    body: 'Refresh the case to see its current status.',
  },
  package_changed: {
    title: 'The package changed',
    body: 'A newer package replaced the one on this screen. Refresh the case and review the current one.',
  },
  digest_mismatch: {
    title: 'The package on this screen is not the current one',
    body: 'Refresh the case and review the package as it stands now.',
  },
  invalid_destination: {
    title: 'That destination is not approved',
    body: 'An approval here covers the HIVE record only.',
  },
  review_missing: {
    title: 'No passing review is on record',
    body: 'A conflict-free reviewer records a pass before an approval.',
  },
  invalid_idempotency_key: {
    title: 'The action could not be prepared',
    body: 'Try again.',
  },
  verdict_missing: {
    title: 'Choose a verdict first',
    body: 'Pick Pass, Return, or Hold, then record it.',
  },
  case_not_approved: {
    title: 'This case is not approved',
    body: 'Only evidence covered by an active approval is filed to the record. Refresh the case to see its status.',
  },
  document_not_filable: {
    title: 'That document cannot be filed',
    body: 'Only a checked document of this case is filed to the record. Choose another document.',
  },
  document_not_approved: {
    title: 'The approval does not cover that document',
    body: 'It was checked after the package was frozen. Reopen the case for changes and send it for review again before filing it.',
  },
  invalid_file_id: {
    title: 'The Drive file id could not be used',
    body: 'Enter the file id exactly as Drive shows it: letters, digits, dashes, and underscores.',
  },
  invalid_path: {
    title: 'The Drive path could not be used',
    body: 'Enter the folder path the document was filed under, up to 240 characters.',
  },
  receipt_exists: {
    title: 'That filing is already on record',
    body: 'A receipt already names this document at this Drive file. Refresh the case to see it.',
  },
  document_missing: {
    title: 'Choose the document first',
    body: 'Pick the checked document you filed, then record the receipt.',
  },
};

/** What each transition means, said before it is confirmed. */
export const CASE_ACTION_CONFIRMATION: Record<CaseAction, { title: string; body: string }> = {
  freeze: {
    title: 'Send this case for review?',
    body: 'The evidence as it stands is frozen into a package a conflict-free reviewer will read. Nothing about the evidence is changed.',
  },
  start_review: {
    title: 'Start the review?',
    body: 'The case shows as in review until you record a verdict. Review is read-only.',
  },
  record_verdict: {
    title: 'Record this verdict?',
    body: 'A recorded verdict cannot be changed. Pass sends the case for approval; Return sends it back for changes; Hold stops it until the hold is lifted.',
  },
  approve: {
    title: 'Approve this exact package?',
    body: 'The approval binds to this package, its digest, and the case version shown, for the HIVE record only, and expires in 30 days. It is not a release, a reconciliation, a completion, or a filing.',
  },
  resume: {
    title: 'Resume work on this case?',
    body: 'The case returns to gathering evidence. An active approval, if any, ends as reopened.',
  },
  record_filing: {
    title: 'Record this filing receipt?',
    body: 'The receipt says you filed exactly this checked document, by its bytes, at this Drive file. HIVE writes nothing to Drive; the record adapter then checks, read-only, that the file holds those bytes.',
  },
};

/** What happened, once the server settled it. */
export const CASE_ACTION_DONE: Record<CaseAction, { title: string; body: string }> = {
  freeze: {
    title: 'Sent for review',
    body: 'The package is frozen and the case is ready for a reviewer.',
  },
  start_review: {
    title: 'Review started',
    body: 'The case shows as in review. Record a verdict when you are done.',
  },
  record_verdict: { title: 'Verdict recorded', body: 'The case moved accordingly.' },
  approve: {
    title: 'Approved',
    body: 'The approval is on record, bound to this package, for the HIVE record only.',
  },
  resume: { title: 'Work resumed', body: 'The case is back to gathering evidence.' },
  record_filing: {
    title: 'Filing receipt recorded',
    body: 'It shows as recorded until the record adapter verifies the file.',
  },
};

/** A filing receipt's state, in staff language (WO-006). */
export const FILING_STATUS_PRESENTATION: Record<FilingStatus, { kind: StatusKind; label: string }> =
  {
    RECORDED: { kind: 'neutral', label: 'Recorded, not yet verified' },
    VERIFIED: { kind: 'stable', label: 'Verified in the record' },
    MISMATCH: { kind: 'attention', label: 'Did not match the record' },
  };

/** Ledger object types, in plain words. Never a value. */
export const LEDGER_OBJECT_TYPE_LABEL: Record<string, string> = {
  Account: 'Account',
  JournalEntry: 'Journal entry',
  Invoice: 'Invoice',
  Bill: 'Bill',
  Payment: 'Payment',
  Report: 'Report',
};

/** The service gate (WO-007): why HIVE is not open right now. The reason
 * is a code from the server, never text; every code has its sentence. */
export const SERVICE_GATE_WORDING: {
  paused: Record<ServiceReason, { title: string; body: string }>;
  updateRequired: { title: string; body: string };
} = {
  paused: {
    none: {
      title: 'HIVE is paused',
      body: 'Honeybee has paused HIVE for now. Your information is safe and nothing has changed. Try again in a little while.',
    },
    maintenance: {
      title: 'HIVE is paused for maintenance',
      body: 'Honeybee is doing planned maintenance. Your information is safe and nothing has changed. Try again in a little while.',
    },
    incident: {
      title: 'HIVE is paused',
      body: 'Honeybee has paused HIVE while it looks into a problem. Your information is safe and nothing has changed. Try again later.',
    },
  },
  updateRequired: {
    title: 'Update HIVE to continue',
    body: 'This version of HIVE is no longer supported. Install the update from your app store, then open HIVE again.',
  },
};

/** Account deletion (WO-007). The explanation separates access deletion
 * from the records the firm keeps for the business; the retention basis
 * itself is Kody's to approve and Stacie's to word. */
export const DELETION_WORDING = {
  explanation:
    'Requesting deletion removes your access to HIVE and the account you sign in with. Records Honeybee Accounting keeps for the business you work with, including documents and answers you provided, are kept under its record-keeping policy and are not deleted by this request. Honeybee completes the deletion and confirms it by email.',
  infoLink: 'How account deletion works',
  request: 'Request account deletion',
  withdraw: 'Withdraw the request',
  confirm: {
    request: {
      title: 'Request account deletion?',
      body: 'Honeybee will remove your access and your sign-in account. You can withdraw the request until it is completed.',
    },
    withdraw: {
      title: 'Withdraw the deletion request?',
      body: 'Your access stays exactly as it is.',
    },
  },
  done: {
    request: {
      title: 'Deletion requested',
      body: 'Honeybee will complete it and confirm by email. You can withdraw the request until then.',
    },
    withdraw: { title: 'Request withdrawn', body: 'Your access stays exactly as it is.' },
  },
  refusals: {
    already_requested: {
      title: 'A deletion request is already open',
      body: 'Refresh to see it.',
    },
    no_open_request: {
      title: 'There is no open request to withdraw',
      body: 'Refresh to see the current state.',
    },
    invalid_idempotency_key: { title: 'The action could not be prepared', body: 'Try again.' },
  } satisfies Record<AccountRefusal, { title: string; body: string }>,
} as const;

export function deletionRequestedLine(requestedAt: string): string {
  return `Requested ${formatServerTimestamp(requestedAt)}. Honeybee will complete it and confirm by email.`;
}
