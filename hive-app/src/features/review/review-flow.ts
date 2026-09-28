/** The case-transition flow as a pure state machine (WO-005).
 *
 * One transition at a time, always through an explicit confirmation:
 *
 *   idle -> confirming -> running -> done
 *                    |          |
 *                    +-> idle   +-> refused | failed
 *
 * The verdict and the note are a draft the idle state carries; a refusal
 * or a failure keeps it so the next action is obvious. `done` is
 * terminal for this flow: the screen reloads the case, and a new flow
 * starts from the new version. The hook in useCaseReview.ts drives this
 * reducer and holds the one thing the screen never sees, the transition's
 * idempotency key.
 */
import type { SafeError } from '@/core/errors';
import type { ReviewRefusal, ReviewVerdict, TransitionReceipt } from '@/data/supabase/reviews';

import type { CaseAction } from './review-rules';

export interface VerdictDraft {
  readonly verdict: ReviewVerdict | null;
  readonly note: string;
}

export type ReviewFlowState =
  | { readonly name: 'idle'; readonly draft: VerdictDraft }
  | { readonly name: 'confirming'; readonly action: CaseAction; readonly draft: VerdictDraft }
  | { readonly name: 'running'; readonly action: CaseAction; readonly draft: VerdictDraft }
  | {
      readonly name: 'done';
      readonly action: CaseAction;
      readonly receipt: TransitionReceipt;
      readonly draft: VerdictDraft;
    }
  | {
      readonly name: 'refused';
      readonly action: CaseAction;
      readonly refusal: ReviewRefusal | 'note_too_long' | 'verdict_missing';
      readonly draft: VerdictDraft;
    }
  | {
      readonly name: 'failed';
      readonly action: CaseAction;
      readonly error: SafeError;
      readonly draft: VerdictDraft;
    };

export type ReviewFlowRefusal = Extract<ReviewFlowState, { name: 'refused' }>['refusal'];

export type ReviewFlowEvent =
  | { type: 'VERDICT_CHOSEN'; verdict: ReviewVerdict }
  | { type: 'NOTE_CHANGED'; note: string }
  | { type: 'ACTION_REQUESTED'; action: CaseAction }
  | { type: 'LOCALLY_REFUSED'; action: CaseAction; refusal: 'note_too_long' | 'verdict_missing' }
  | { type: 'CANCELED' }
  | { type: 'STARTED' }
  | { type: 'SUCCEEDED'; receipt: TransitionReceipt }
  | { type: 'REFUSED'; refusal: ReviewRefusal }
  | { type: 'FAILED'; error: SafeError }
  | { type: 'DISMISSED' };

export const initialReviewState: ReviewFlowState = {
  name: 'idle',
  draft: { verdict: null, note: '' },
};

/** Refusals after which the screen's copy is behind the server's: the
 * way forward is a reload, and the screen offers exactly that. */
export function isStaleRefusal(refusal: ReviewFlowRefusal): boolean {
  return (
    refusal === 'case_changed' ||
    refusal === 'case_not_freezable' ||
    refusal === 'case_not_reviewable' ||
    refusal === 'case_not_resumable' ||
    refusal === 'case_not_approvable' ||
    refusal === 'package_changed' ||
    refusal === 'digest_mismatch' ||
    refusal === 'review_in_progress' ||
    refusal === 'not_your_review' ||
    refusal === 'package_missing' ||
    refusal === 'review_missing'
  );
}

/** The pure transition. An event without meaning in the current state
 * leaves the state unchanged: the flow fails closed. */
export function reviewReducer(state: ReviewFlowState, event: ReviewFlowEvent): ReviewFlowState {
  switch (state.name) {
    case 'idle':
      if (event.type === 'VERDICT_CHOSEN') {
        return { name: 'idle', draft: { ...state.draft, verdict: event.verdict } };
      }
      if (event.type === 'NOTE_CHANGED') {
        return { name: 'idle', draft: { ...state.draft, note: event.note } };
      }
      if (event.type === 'ACTION_REQUESTED') {
        return { name: 'confirming', action: event.action, draft: state.draft };
      }
      if (event.type === 'LOCALLY_REFUSED') {
        return {
          name: 'refused',
          action: event.action,
          refusal: event.refusal,
          draft: state.draft,
        };
      }
      return state;
    case 'confirming':
      if (event.type === 'CANCELED') return { name: 'idle', draft: state.draft };
      if (event.type === 'STARTED')
        return { name: 'running', action: state.action, draft: state.draft };
      return state;
    case 'running':
      if (event.type === 'SUCCEEDED') {
        return { name: 'done', action: state.action, receipt: event.receipt, draft: state.draft };
      }
      if (event.type === 'REFUSED') {
        return {
          name: 'refused',
          action: state.action,
          refusal: event.refusal,
          draft: state.draft,
        };
      }
      if (event.type === 'FAILED') {
        return { name: 'failed', action: state.action, error: event.error, draft: state.draft };
      }
      return state;
    case 'done':
      return state;
    case 'refused':
      if (event.type === 'DISMISSED') return { name: 'idle', draft: state.draft };
      return state;
    case 'failed':
      if (event.type === 'DISMISSED') return { name: 'idle', draft: state.draft };
      if (event.type === 'STARTED')
        return { name: 'running', action: state.action, draft: state.draft };
      return state;
  }
}

export function isBusy(state: ReviewFlowState): boolean {
  return state.name === 'running';
}

/** Whether the screen may offer the actions in this state. */
export function canAct(state: ReviewFlowState): boolean {
  return state.name === 'idle';
}
