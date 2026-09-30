/** The add-document flow as a pure state machine (WO-003).
 *
 * One document at a time, from the picker to quarantine:
 *
 *   idle -> picking -> checking -> checked -> sending -> received
 *                 \           \         \            \
 *                  `-> idle    `-> refused          `-> refused | failed
 *
 * Every state is explicit and every failure is a state the screen renders
 * with its own wording; nothing is retried behind the person's back, and
 * the typed answer never disappears: a refusal or a failure keeps the
 * checked document on screen so the next action is obvious. The hook in
 * useAddDocument.ts drives this reducer; it holds the bytes, the digest,
 * and the idempotency key outside the state, memory-only.
 */
import type { SafeError } from '@/core/errors';
import type { UploadRefusal } from '@/data/supabase/documents';

import type { CheckedDocument, DocumentCheckRefusal, PickedDocument } from './document-rules';

export type AddDocumentRefusal = DocumentCheckRefusal | UploadRefusal;

export type SendingStep = 'reserving' | 'transferring' | 'confirming';

export type AddDocumentState =
  | { readonly name: 'idle' }
  | { readonly name: 'picking' }
  | { readonly name: 'checking'; readonly picked: PickedDocument }
  | { readonly name: 'checked'; readonly document: CheckedDocument; readonly digest: string }
  | {
      readonly name: 'sending';
      readonly document: CheckedDocument;
      readonly digest: string;
      readonly step: SendingStep;
    }
  | {
      readonly name: 'received';
      readonly document: CheckedDocument;
      readonly receivedAt: string | null;
    }
  | {
      readonly name: 'refused';
      readonly refusal: AddDocumentRefusal;
      /** Present when the refusal came after the local check passed. */
      readonly document: CheckedDocument | null;
    }
  | {
      readonly name: 'failed';
      readonly error: SafeError;
      /** Present when a checked document can be sent again as-is. */
      readonly document: CheckedDocument | null;
      readonly digest: string | null;
    };

export type AddDocumentEvent =
  | { type: 'PICK_STARTED' }
  | { type: 'PICK_CANCELED' }
  | { type: 'PICK_FAILED'; error: SafeError }
  | { type: 'PICKED'; picked: PickedDocument }
  | { type: 'CHECK_REFUSED'; refusal: DocumentCheckRefusal }
  | { type: 'CHECK_FAILED'; error: SafeError }
  | { type: 'CHECKED'; document: CheckedDocument; digest: string }
  | { type: 'SEND_STARTED' }
  | { type: 'SEND_STEP'; step: SendingStep }
  | { type: 'SENT'; receivedAt: string | null }
  | { type: 'SEND_REFUSED'; refusal: UploadRefusal }
  | { type: 'SEND_FAILED'; error: SafeError }
  | { type: 'RESET' };

export const initialAddDocumentState: AddDocumentState = { name: 'idle' };

/** The pure transition. An event that has no meaning in the current
 * state leaves the state unchanged: the flow fails closed rather than
 * inventing a step, and the hook never sends one. */
export function addDocumentReducer(
  state: AddDocumentState,
  event: AddDocumentEvent,
): AddDocumentState {
  if (event.type === 'RESET') return initialAddDocumentState;
  switch (state.name) {
    case 'idle':
    case 'received':
    case 'refused':
      if (event.type === 'PICK_STARTED') return { name: 'picking' };
      if (event.type === 'SEND_STARTED' && state.name === 'refused' && state.document) {
        // A refused document is never re-sent as-is: the refusal said why.
        return state;
      }
      return state;
    case 'failed':
      if (event.type === 'PICK_STARTED') return { name: 'picking' };
      if (event.type === 'SEND_STARTED' && state.document && state.digest !== null) {
        return {
          name: 'sending',
          document: state.document,
          digest: state.digest,
          step: 'reserving',
        };
      }
      return state;
    case 'picking':
      if (event.type === 'PICK_CANCELED') return { name: 'idle' };
      if (event.type === 'PICK_FAILED') {
        return { name: 'failed', error: event.error, document: null, digest: null };
      }
      if (event.type === 'PICKED') return { name: 'checking', picked: event.picked };
      return state;
    case 'checking':
      if (event.type === 'CHECK_REFUSED') {
        return { name: 'refused', refusal: event.refusal, document: null };
      }
      if (event.type === 'CHECK_FAILED') {
        return { name: 'failed', error: event.error, document: null, digest: null };
      }
      if (event.type === 'CHECKED') {
        return { name: 'checked', document: event.document, digest: event.digest };
      }
      return state;
    case 'checked':
      if (event.type === 'SEND_STARTED') {
        return {
          name: 'sending',
          document: state.document,
          digest: state.digest,
          step: 'reserving',
        };
      }
      if (event.type === 'PICK_STARTED') return { name: 'picking' };
      return state;
    case 'sending':
      if (event.type === 'SEND_STEP') return { ...state, step: event.step };
      if (event.type === 'SENT') {
        return { name: 'received', document: state.document, receivedAt: event.receivedAt };
      }
      if (event.type === 'SEND_REFUSED') {
        return { name: 'refused', refusal: event.refusal, document: state.document };
      }
      if (event.type === 'SEND_FAILED') {
        return {
          name: 'failed',
          error: event.error,
          document: state.document,
          digest: state.digest,
        };
      }
      return state;
  }
}

/** Whether the screen may offer the primary action in this state. */
export function canSend(state: AddDocumentState): boolean {
  return (
    state.name === 'checked' ||
    (state.name === 'failed' && state.document !== null && state.digest !== null)
  );
}

/** Whether the screen may offer the picker in this state. */
export function canChoose(state: AddDocumentState): boolean {
  return (
    state.name === 'idle' ||
    state.name === 'checked' ||
    state.name === 'received' ||
    state.name === 'refused' ||
    state.name === 'failed'
  );
}

/** Whether a transfer or check is in flight: the screen shows it and
 * blocks every other action. */
export function isBusy(state: AddDocumentState): boolean {
  return state.name === 'picking' || state.name === 'checking' || state.name === 'sending';
}
