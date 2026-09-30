/** useAnswer: drives the answer flow against the answer writer.
 *
 * The reducer (answer-flow.ts) owns what the screen shows; this hook owns
 * what the screen must never see: the idempotency key of a submission.
 * One key per confirmation: made when the person asks to submit, kept
 * through a transient failure so "try again" can never submit twice, and
 * dropped when the submission settles, is canceled, or is dismissed. A
 * late result from a step the person has moved past is dropped by epoch,
 * the same rule the scoped reads follow (P2-9).
 *
 * Every write names the request's version the screen read and the
 * draft's version the server last reported, so a request or a draft that
 * moved elsewhere is a refusal the screen words, never an overwrite.
 */
import { useCallback, useEffect, useReducer, useRef } from 'react';

import { toSafeError } from '@/core/errors';
import { type RandomSource, cryptoRandomSource, newUuid } from '@/core/ids';
import {
  AnswerRefusedError,
  type AnswerWriter,
  type DraftReceipt,
  type RequestAnswer,
} from '@/data/supabase/answers';
import type { ScopeKey } from '@/tenancy/scope-key';

import {
  type AnswerDraft,
  type AnswerFlowState,
  answerReducer,
  canSave,
  initialAnswerState,
  needsSave,
} from './answer-flow';
import { checkAnswerText, sanitizeAnswerText } from './answer-rules';

export interface AnswerDeps {
  scope: ScopeKey;
  request: { readonly id: string; readonly version: number };
  /** The server's draft when one exists; the flow starts from it. */
  existing: RequestAnswer | null;
  writer: AnswerWriter;
  /** Explicit on device (core's web-crypto default throws under Hermes,
   * find 14); the default serves jest and the live bridge. */
  random?: RandomSource;
  /** An expired session met during a write: the caller routes it to the
   * auth controller exactly as a read would. */
  onSessionExpired?: () => void;
}

export interface AnswerController {
  readonly state: AnswerFlowState;
  setText: (body: string) => void;
  toggleCitation: (documentId: string) => void;
  save: () => void;
  requestSubmit: () => void;
  cancelSubmit: () => void;
  confirmSubmit: () => void;
  dismiss: () => void;
  /** After a failure: the same step again, with the same key. */
  retry: () => void;
}

export function useAnswer(deps: AnswerDeps): AnswerController {
  const { scope, request, existing, writer, random = cryptoRandomSource, onSessionExpired } = deps;
  const [state, dispatch] = useReducer(answerReducer, existing, initialAnswerState);
  const submitKey = useRef<string | null>(null);
  const epoch = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      epoch.current += 1;
      submitKey.current = null;
    };
  }, []);

  const stale = (started: number): boolean => started !== epoch.current || !mounted.current;

  const saveDraft = useCallback(
    async (draft: AnswerDraft): Promise<DraftReceipt> =>
      writer.saveDraft(scope, {
        requestId: request.id,
        requestVersion: request.version,
        body: sanitizeAnswerText(draft.body),
        citedDocumentIds: draft.citedDocumentIds,
        answerVersion: draft.saved?.version ?? null,
      }),
    [request.id, request.version, scope, writer],
  );

  const setText = useCallback((body: string) => {
    dispatch({ type: 'TEXT_CHANGED', body: sanitizeAnswerText(body) });
  }, []);

  const toggleCitation = useCallback((documentId: string) => {
    dispatch({ type: 'CITATION_TOGGLED', documentId });
  }, []);

  const runSave = useCallback(
    (draft: AnswerDraft) => {
      const started = ++epoch.current;
      dispatch({ type: 'SAVE_STARTED' });
      void (async () => {
        try {
          const receipt = await saveDraft(draft);
          if (stale(started)) return;
          dispatch({
            type: 'SAVED',
            receipt,
            body: sanitizeAnswerText(draft.body),
            citedDocumentIds: draft.citedDocumentIds,
          });
        } catch (error) {
          if (stale(started)) return;
          if (error instanceof AnswerRefusedError) {
            dispatch({ type: 'SAVE_REFUSED', refusal: error.refusal });
            return;
          }
          const safe = toSafeError(error);
          if (safe.code === 'auth_expired') onSessionExpired?.();
          dispatch({ type: 'SAVE_FAILED', error: safe });
        }
      })();
    },
    [onSessionExpired, saveDraft],
  );

  const save = useCallback(() => {
    if (!canSave(state)) return;
    runSave(state.draft);
  }, [runSave, state]);

  const requestSubmit = useCallback(() => {
    if (state.name !== 'editing') return;
    const check = checkAnswerText(state.draft.body);
    if (!check.ok) {
      dispatch({ type: 'SUBMIT_REFUSED', refusal: check.refusal });
      return;
    }
    submitKey.current = newUuid(random);
    dispatch({ type: 'SUBMIT_REQUESTED' });
  }, [random, state]);

  const cancelSubmit = useCallback(() => {
    if (state.name !== 'confirming') return;
    submitKey.current = null;
    dispatch({ type: 'SUBMIT_CANCELED' });
  }, [state.name]);

  const runSubmit = useCallback(
    (draft: AnswerDraft) => {
      const key = submitKey.current ?? newUuid(random);
      submitKey.current = key;
      const started = ++epoch.current;
      const saveFirst = needsSave(draft);
      dispatch({ type: 'SUBMIT_STARTED', step: saveFirst ? 'saving' : 'submitting' });
      void (async () => {
        try {
          let saved = draft.saved;
          if (saveFirst || !saved) {
            const receipt = await saveDraft(draft);
            if (stale(started)) return;
            const body = sanitizeAnswerText(draft.body);
            dispatch({
              type: 'SAVED',
              receipt,
              body,
              citedDocumentIds: draft.citedDocumentIds,
            });
            saved = {
              answerId: receipt.answerId,
              version: receipt.version,
              updatedAt: receipt.updatedAt,
              body,
              citedDocumentIds: draft.citedDocumentIds,
            };
          }
          const receipt = await writer.submit({
            answerId: saved.answerId,
            answerVersion: saved.version,
            idempotencyKey: key,
          });
          if (stale(started)) return;
          submitKey.current = null;
          dispatch({ type: 'SUBMITTED', submittedAt: receipt.submittedAt });
        } catch (error) {
          if (stale(started)) return;
          if (error instanceof AnswerRefusedError) {
            submitKey.current = null;
            dispatch({ type: 'SUBMIT_REFUSED', refusal: error.refusal });
            return;
          }
          const safe = toSafeError(error);
          if (safe.code === 'auth_expired') onSessionExpired?.();
          // The key stays: a retry must not be able to submit twice.
          dispatch({ type: 'SUBMIT_FAILED', error: safe });
        }
      })();
    },
    [onSessionExpired, random, saveDraft, writer],
  );

  const confirmSubmit = useCallback(() => {
    if (state.name !== 'confirming') return;
    runSubmit(state.draft);
  }, [runSubmit, state]);

  const retry = useCallback(() => {
    if (state.name !== 'failed') return;
    if (state.during === 'save') runSave(state.draft);
    else runSubmit(state.draft);
  }, [runSave, runSubmit, state]);

  const dismiss = useCallback(() => {
    if (state.name !== 'refused' && state.name !== 'failed') return;
    submitKey.current = null;
    dispatch({ type: 'DISMISSED' });
  }, [state.name]);

  return {
    state,
    setText,
    toggleCitation,
    save,
    requestSubmit,
    cancelSubmit,
    confirmSubmit,
    dismiss,
    retry,
  };
}
