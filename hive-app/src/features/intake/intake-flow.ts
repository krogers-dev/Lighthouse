/** A creation as a pure state machine (WO-013): a case, or a request on
 * a case. The same shape as the transition flow of WO-005, because it is
 * the same discipline: one thing at a time, through an explicit
 * confirmation, with the draft kept through a refusal or a failure.
 *
 *   idle -> confirming -> running -> done
 *                    |          |
 *                    +-> idle   +-> refused | failed
 *
 * `done` is terminal: the screen moves on to what was created. The hook
 * in useCreation.ts drives this reducer and holds the one thing the
 * screen never sees, the creation's idempotency key.
 */
import type { SafeError } from '@/core/errors';
import type { ReviewRefusal } from '@/data/supabase/reviews';

import type { IntakeLocalRefusal } from './intake-rules';

export type CreationRefusal = ReviewRefusal | IntakeLocalRefusal;

export type CreationState<D, R> =
  | { readonly name: 'idle'; readonly draft: D }
  | { readonly name: 'confirming'; readonly draft: D }
  | { readonly name: 'running'; readonly draft: D }
  | { readonly name: 'done'; readonly draft: D; readonly result: R }
  | { readonly name: 'refused'; readonly draft: D; readonly refusal: CreationRefusal }
  | { readonly name: 'failed'; readonly draft: D; readonly error: SafeError };

export type CreationEvent<D, R> =
  | { type: 'DRAFT_CHANGED'; draft: D }
  | { type: 'CONFIRM_REQUESTED' }
  | { type: 'LOCALLY_REFUSED'; refusal: IntakeLocalRefusal }
  | { type: 'CANCELED' }
  | { type: 'STARTED' }
  | { type: 'SUCCEEDED'; result: R }
  | { type: 'REFUSED'; refusal: ReviewRefusal }
  | { type: 'FAILED'; error: SafeError }
  | { type: 'DISMISSED' };

export function initialCreationState<D, R>(draft: D): CreationState<D, R> {
  return { name: 'idle', draft };
}

/** Refusals after which the screen's copy is behind the server's: the
 * way forward is the case screen, refreshed. */
export function isStaleCreationRefusal(refusal: CreationRefusal): boolean {
  return (
    refusal === 'case_not_found' ||
    refusal === 'case_changed' ||
    refusal === 'case_not_open_for_requests' ||
    refusal === 'document_not_checked' ||
    refusal === 'too_many_requests' ||
    refusal === 'too_many_drafts'
  );
}

/** The pure transition. An event without meaning in the current state
 * leaves the state unchanged: the flow fails closed. */
export function creationReducer<D, R>(
  state: CreationState<D, R>,
  event: CreationEvent<D, R>,
): CreationState<D, R> {
  switch (state.name) {
    case 'idle':
      if (event.type === 'DRAFT_CHANGED') return { name: 'idle', draft: event.draft };
      if (event.type === 'CONFIRM_REQUESTED') return { name: 'confirming', draft: state.draft };
      if (event.type === 'LOCALLY_REFUSED') {
        return { name: 'refused', draft: state.draft, refusal: event.refusal };
      }
      return state;
    case 'confirming':
      if (event.type === 'CANCELED') return { name: 'idle', draft: state.draft };
      if (event.type === 'STARTED') return { name: 'running', draft: state.draft };
      return state;
    case 'running':
      if (event.type === 'SUCCEEDED') {
        return { name: 'done', draft: state.draft, result: event.result };
      }
      if (event.type === 'REFUSED') {
        return { name: 'refused', draft: state.draft, refusal: event.refusal };
      }
      if (event.type === 'FAILED')
        return { name: 'failed', draft: state.draft, error: event.error };
      return state;
    case 'done':
      return state;
    case 'refused':
      if (event.type === 'DISMISSED') return { name: 'idle', draft: state.draft };
      return state;
    case 'failed':
      if (event.type === 'DISMISSED') return { name: 'idle', draft: state.draft };
      if (event.type === 'STARTED') return { name: 'running', draft: state.draft };
      return state;
  }
}

export function isCreationBusy<D, R>(state: CreationState<D, R>): boolean {
  return state.name === 'running';
}

export function canEdit<D, R>(state: CreationState<D, R>): boolean {
  return state.name === 'idle';
}
