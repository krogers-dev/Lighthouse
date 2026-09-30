/** The account-deletion request flow as a pure state machine (WO-007).
 *
 * One action at a time, always through an explicit confirmation:
 *
 *   idle -> confirming -> running -> done
 *                    |          |
 *                    +-> idle   +-> refused | failed
 *
 * `done` stays on screen until the person dismisses it; the hook in
 * useDeletionRequest.ts reloads the request from the server the moment
 * an action settles, drives this reducer, and holds the transition's
 * idempotency key.
 */
import type { SafeError } from '@/core/errors';
import type { AccountRefusal, DeletionReceipt } from '@/data/supabase/account';

export type DeletionAction = 'request' | 'withdraw';

export type DeletionFlowState =
  | { readonly name: 'idle' }
  | { readonly name: 'confirming'; readonly action: DeletionAction }
  | { readonly name: 'running'; readonly action: DeletionAction }
  | { readonly name: 'done'; readonly action: DeletionAction; readonly receipt: DeletionReceipt }
  | { readonly name: 'refused'; readonly action: DeletionAction; readonly refusal: AccountRefusal }
  | { readonly name: 'failed'; readonly action: DeletionAction; readonly error: SafeError };

export type DeletionFlowEvent =
  | { type: 'ACTION_REQUESTED'; action: DeletionAction }
  | { type: 'CANCELED' }
  | { type: 'STARTED' }
  | { type: 'SUCCEEDED'; receipt: DeletionReceipt }
  | { type: 'REFUSED'; refusal: AccountRefusal }
  | { type: 'FAILED'; error: SafeError }
  | { type: 'DISMISSED' };

export const initialDeletionState: DeletionFlowState = { name: 'idle' };

/** Every refusal here means the screen's copy is behind the server's: the
 * way forward is a reload, and the screen offers exactly that. */
export function isStaleDeletionRefusal(refusal: AccountRefusal): boolean {
  return refusal === 'already_requested' || refusal === 'no_open_request';
}

export function deletionReducer(
  state: DeletionFlowState,
  event: DeletionFlowEvent,
): DeletionFlowState {
  switch (state.name) {
    case 'idle':
      if (event.type === 'ACTION_REQUESTED') return { name: 'confirming', action: event.action };
      return state;
    case 'confirming':
      if (event.type === 'CANCELED') return { name: 'idle' };
      if (event.type === 'STARTED') return { name: 'running', action: state.action };
      return state;
    case 'running':
      if (event.type === 'SUCCEEDED') {
        return { name: 'done', action: state.action, receipt: event.receipt };
      }
      if (event.type === 'REFUSED') {
        return { name: 'refused', action: state.action, refusal: event.refusal };
      }
      if (event.type === 'FAILED')
        return { name: 'failed', action: state.action, error: event.error };
      return state;
    case 'done':
      if (event.type === 'DISMISSED') return { name: 'idle' };
      return state;
    case 'refused':
      if (event.type === 'DISMISSED') return { name: 'idle' };
      return state;
    case 'failed':
      if (event.type === 'DISMISSED') return { name: 'idle' };
      if (event.type === 'STARTED') return { name: 'running', action: state.action };
      return state;
  }
}
