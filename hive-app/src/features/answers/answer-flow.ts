/** The answer flow as a pure state machine (WO-004).
 *
 * One draft per request, kept on the server, settled by one explicit
 * submission:
 *
 *   editing <-> saving                 (save the draft, stay editing)
 *   editing -> confirming -> submitting -> submitted
 *                       |            |
 *                       +-> editing  +-> refused | failed
 *
 * Every state is explicit and every failure is a state the screen renders
 * with its own wording. The typed answer never disappears: a refusal or a
 * failure keeps the draft in the state so the next action is obvious, and
 * "keep editing" returns to it. The hook in useAnswer.ts drives this
 * reducer and holds the one thing the screen must never see, the
 * submission's idempotency key.
 */
import type { SafeError } from '@/core/errors';
import type { AnswerRefusal, DraftReceipt, RequestAnswer } from '@/data/supabase/answers';

/** The server's copy of the draft, as of the last receipt. */
export interface SavedDraft {
  readonly answerId: string;
  readonly version: number;
  readonly updatedAt: string;
  readonly body: string;
  readonly citedDocumentIds: readonly string[];
}

export interface AnswerDraft {
  readonly body: string;
  readonly citedDocumentIds: readonly string[];
  readonly saved: SavedDraft | null;
}

export type AnswerFlowRefusal = AnswerRefusal;

export type SubmitStep = 'saving' | 'submitting';

export type AnswerFlowState =
  | { readonly name: 'editing'; readonly draft: AnswerDraft; readonly notice: 'saved' | null }
  | { readonly name: 'saving'; readonly draft: AnswerDraft }
  | { readonly name: 'confirming'; readonly draft: AnswerDraft }
  | { readonly name: 'submitting'; readonly draft: AnswerDraft; readonly step: SubmitStep }
  | { readonly name: 'submitted'; readonly draft: AnswerDraft; readonly submittedAt: string | null }
  | {
      readonly name: 'refused';
      readonly draft: AnswerDraft;
      readonly refusal: AnswerFlowRefusal;
      readonly during: 'save' | 'submit';
    }
  | {
      readonly name: 'failed';
      readonly draft: AnswerDraft;
      readonly error: SafeError;
      readonly during: 'save' | 'submit';
    };

export type AnswerFlowEvent =
  | { type: 'TEXT_CHANGED'; body: string }
  | { type: 'CITATION_TOGGLED'; documentId: string }
  | { type: 'SAVE_STARTED' }
  | { type: 'SAVED'; receipt: DraftReceipt; body: string; citedDocumentIds: readonly string[] }
  | { type: 'SAVE_REFUSED'; refusal: AnswerFlowRefusal }
  | { type: 'SAVE_FAILED'; error: SafeError }
  | { type: 'SUBMIT_REQUESTED' }
  | { type: 'SUBMIT_CANCELED' }
  | { type: 'SUBMIT_STARTED'; step: SubmitStep }
  | { type: 'SUBMITTED'; submittedAt: string | null }
  | { type: 'SUBMIT_REFUSED'; refusal: AnswerFlowRefusal }
  | { type: 'SUBMIT_FAILED'; error: SafeError }
  | { type: 'DISMISSED' };

const EMPTY_DRAFT: AnswerDraft = { body: '', citedDocumentIds: [], saved: null };

/** The flow starts from what the server holds: an existing draft, with
 * its text and citations, or nothing. */
export function initialAnswerState(existing: RequestAnswer | null): AnswerFlowState {
  if (!existing || existing.status !== 'DRAFT') {
    return { name: 'editing', draft: EMPTY_DRAFT, notice: null };
  }
  return {
    name: 'editing',
    draft: {
      body: existing.body,
      citedDocumentIds: existing.citedDocumentIds,
      saved: {
        answerId: existing.id,
        version: existing.version,
        updatedAt: existing.updatedAt,
        body: existing.body,
        citedDocumentIds: existing.citedDocumentIds,
      },
    },
    notice: null,
  };
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
}

/** Whether the draft differs from the server's copy (or exists at all). */
export function isDirty(draft: AnswerDraft): boolean {
  if (!draft.saved) return draft.body.length > 0 || draft.citedDocumentIds.length > 0;
  return (
    draft.body !== draft.saved.body ||
    !sameIds(draft.citedDocumentIds, draft.saved.citedDocumentIds)
  );
}

/** A submission needs a server-side draft at the current text. */
export function needsSave(draft: AnswerDraft): boolean {
  return draft.saved === null || isDirty(draft);
}

function savedFrom(
  receipt: DraftReceipt,
  body: string,
  citedDocumentIds: readonly string[],
): SavedDraft {
  return {
    answerId: receipt.answerId,
    version: receipt.version,
    updatedAt: receipt.updatedAt,
    body,
    citedDocumentIds,
  };
}

/** Refusals after which nothing on this screen can help: the way back is
 * the only control. */
export function isTerminalRefusal(refusal: AnswerFlowRefusal): boolean {
  return (
    refusal === 'request_not_found' ||
    refusal === 'request_closed' ||
    refusal === 'already_submitted'
  );
}

/** Refusals that mean the screen's copy is behind the server's: the
 * request or the draft moved elsewhere, so the person goes back and
 * starts from the latest state. The text stays on screen meanwhile. */
export function isStaleRefusal(refusal: AnswerFlowRefusal): boolean {
  return refusal === 'request_changed' || refusal === 'answer_changed';
}

export function canKeepEditing(refusal: AnswerFlowRefusal): boolean {
  return !isTerminalRefusal(refusal) && !isStaleRefusal(refusal);
}

/** The pure transition. An event that has no meaning in the current
 * state leaves the state unchanged: the flow fails closed rather than
 * inventing a step, and the hook never sends one. */
export function answerReducer(state: AnswerFlowState, event: AnswerFlowEvent): AnswerFlowState {
  switch (state.name) {
    case 'editing':
      if (event.type === 'TEXT_CHANGED') {
        return { name: 'editing', draft: { ...state.draft, body: event.body }, notice: null };
      }
      if (event.type === 'CITATION_TOGGLED') {
        const current = state.draft.citedDocumentIds;
        const citedDocumentIds = current.includes(event.documentId)
          ? current.filter((id) => id !== event.documentId)
          : [...current, event.documentId];
        return { name: 'editing', draft: { ...state.draft, citedDocumentIds }, notice: null };
      }
      if (event.type === 'SAVE_STARTED') {
        return isDirty(state.draft) ? { name: 'saving', draft: state.draft } : state;
      }
      if (event.type === 'SUBMIT_REQUESTED') return { name: 'confirming', draft: state.draft };
      if (event.type === 'SUBMIT_REFUSED') {
        // The local text check refused it before any round trip.
        return { name: 'refused', draft: state.draft, refusal: event.refusal, during: 'submit' };
      }
      return state;
    case 'saving':
      if (event.type === 'SAVED') {
        return {
          name: 'editing',
          draft: {
            ...state.draft,
            saved: savedFrom(event.receipt, event.body, event.citedDocumentIds),
          },
          notice: 'saved',
        };
      }
      if (event.type === 'SAVE_REFUSED') {
        return { name: 'refused', draft: state.draft, refusal: event.refusal, during: 'save' };
      }
      if (event.type === 'SAVE_FAILED') {
        return { name: 'failed', draft: state.draft, error: event.error, during: 'save' };
      }
      return state;
    case 'confirming':
      if (event.type === 'SUBMIT_CANCELED') {
        return { name: 'editing', draft: state.draft, notice: null };
      }
      if (event.type === 'SUBMIT_STARTED') {
        return { name: 'submitting', draft: state.draft, step: event.step };
      }
      return state;
    case 'submitting':
      if (event.type === 'SAVED') {
        return {
          name: 'submitting',
          draft: {
            ...state.draft,
            saved: savedFrom(event.receipt, event.body, event.citedDocumentIds),
          },
          step: 'submitting',
        };
      }
      if (event.type === 'SUBMITTED') {
        return { name: 'submitted', draft: state.draft, submittedAt: event.submittedAt };
      }
      if (event.type === 'SAVE_REFUSED' || event.type === 'SUBMIT_REFUSED') {
        return { name: 'refused', draft: state.draft, refusal: event.refusal, during: 'submit' };
      }
      if (event.type === 'SAVE_FAILED' || event.type === 'SUBMIT_FAILED') {
        return { name: 'failed', draft: state.draft, error: event.error, during: 'submit' };
      }
      return state;
    case 'submitted':
      // Settled: a submitted answer is immutable, on the server and here.
      return state;
    case 'refused':
      if (event.type === 'DISMISSED' && canKeepEditing(state.refusal)) {
        return { name: 'editing', draft: state.draft, notice: null };
      }
      return state;
    case 'failed':
      if (event.type === 'DISMISSED') return { name: 'editing', draft: state.draft, notice: null };
      if (event.type === 'SAVE_STARTED' && state.during === 'save') {
        return { name: 'saving', draft: state.draft };
      }
      if (event.type === 'SUBMIT_STARTED' && state.during === 'submit') {
        return { name: 'submitting', draft: state.draft, step: event.step };
      }
      return state;
  }
}

/** Whether the screen may offer "Save draft" in this state. */
export function canSave(state: AnswerFlowState): boolean {
  return state.name === 'editing' && isDirty(state.draft);
}

/** Whether the screen may offer "Submit answer" in this state. */
export function canSubmit(state: AnswerFlowState): boolean {
  return state.name === 'editing';
}

/** Whether a round trip is in flight: the screen shows it and blocks
 * every other action, including the way back. */
export function isBusy(state: AnswerFlowState): boolean {
  return state.name === 'saving' || state.name === 'submitting';
}
