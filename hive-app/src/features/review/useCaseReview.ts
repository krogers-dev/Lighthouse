/** useCaseReview: drives one case transition against the review writer.
 *
 * The reducer (review-flow.ts) owns what the screen shows; this hook owns
 * the transition's idempotency key: made when the person asks for the
 * action, kept through a transient failure so "try again" can never move
 * the case twice, and dropped when the transition settles, is canceled,
 * or is dismissed. Every write names the case's version the screen read,
 * and an approval names the exact package id and digest the screen
 * showed, so a case or a package that moved elsewhere is a refusal the
 * screen words, never an action on stale state. A late result from a
 * step the person has moved past is dropped by epoch (P2-9).
 */
import { useCallback, useEffect, useReducer, useRef } from 'react';

import { toSafeError } from '@/core/errors';
import { type RandomSource, cryptoRandomSource, newUuid } from '@/core/ids';
import {
  ReviewRefusedError,
  type ReviewVerdict,
  type ReviewWriter,
  type TransitionReceipt,
} from '@/data/supabase/reviews';
import type { ScopeKey } from '@/tenancy/scope-key';

import { type ReviewFlowState, initialReviewState, reviewReducer } from './review-flow';
import { APPROVAL_DESTINATION, type CaseAction, checkNote, sanitizeNote } from './review-rules';

export interface CaseReviewDeps {
  scope: ScopeKey;
  caseRecord: { readonly id: string; readonly version: number };
  /** The current package as the screen showed it; an approval binds to it. */
  package: { readonly id: string; readonly manifestDigest: string } | null;
  writer: ReviewWriter;
  /** Explicit on device (core's web-crypto default throws under Hermes,
   * find 14); the default serves jest and the live bridge. */
  random?: RandomSource;
  onSessionExpired?: () => void;
  /** A settled transition: the screen reloads the case from the server. */
  onSettled?: (receipt: TransitionReceipt) => void;
}

export interface CaseReviewController {
  readonly state: ReviewFlowState;
  chooseVerdict: (verdict: ReviewVerdict) => void;
  setNote: (note: string) => void;
  request: (action: CaseAction) => void;
  cancel: () => void;
  confirm: () => void;
  retry: () => void;
  dismiss: () => void;
}

export function useCaseReview(deps: CaseReviewDeps): CaseReviewController {
  const {
    scope,
    caseRecord,
    package: currentPackage,
    writer,
    random = cryptoRandomSource,
    onSessionExpired,
    onSettled,
  } = deps;
  const [state, dispatch] = useReducer(reviewReducer, initialReviewState);
  const key = useRef<string | null>(null);
  const epoch = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      epoch.current += 1;
      key.current = null;
    };
  }, []);

  const stale = (started: number): boolean => started !== epoch.current || !mounted.current;

  const chooseVerdict = useCallback((verdict: ReviewVerdict) => {
    dispatch({ type: 'VERDICT_CHOSEN', verdict });
  }, []);

  const setNote = useCallback((note: string) => {
    dispatch({ type: 'NOTE_CHANGED', note: sanitizeNote(note) });
  }, []);

  const request = useCallback(
    (action: CaseAction) => {
      if (state.name !== 'idle') return;
      if (action === 'record_verdict') {
        if (state.draft.verdict === null) {
          dispatch({ type: 'LOCALLY_REFUSED', action, refusal: 'verdict_missing' });
          return;
        }
        const note = checkNote(state.draft.note);
        if (!note.ok) {
          dispatch({ type: 'LOCALLY_REFUSED', action, refusal: note.refusal });
          return;
        }
      }
      key.current = newUuid(random);
      dispatch({ type: 'ACTION_REQUESTED', action });
    },
    [random, state],
  );

  const cancel = useCallback(() => {
    if (state.name !== 'confirming') return;
    key.current = null;
    dispatch({ type: 'CANCELED' });
  }, [state.name]);

  const run = useCallback(
    (action: CaseAction, draft: { verdict: ReviewVerdict | null; note: string }) => {
      const idempotencyKey = key.current ?? newUuid(random);
      key.current = idempotencyKey;
      const started = ++epoch.current;
      dispatch({ type: 'STARTED' });
      void (async () => {
        try {
          const base = { caseId: caseRecord.id, caseVersion: caseRecord.version, idempotencyKey };
          let receipt: TransitionReceipt;
          if (action === 'freeze') {
            receipt = await writer.freeze(scope, base);
          } else if (action === 'start_review') {
            receipt = await writer.startReview(scope, base);
          } else if (action === 'resume') {
            receipt = await writer.resume(scope, base);
          } else if (action === 'record_verdict') {
            if (draft.verdict === null) throw new ReviewRefusedError('invalid_verdict');
            receipt = await writer.recordVerdict(scope, {
              ...base,
              verdict: draft.verdict,
              note: sanitizeNote(draft.note),
            });
          } else {
            if (!currentPackage) throw new ReviewRefusedError('package_missing');
            receipt = await writer.approve(scope, {
              ...base,
              packageId: currentPackage.id,
              packageDigest: currentPackage.manifestDigest,
              destination: APPROVAL_DESTINATION,
            });
          }
          if (stale(started)) return;
          key.current = null;
          dispatch({ type: 'SUCCEEDED', receipt });
          onSettled?.(receipt);
        } catch (error) {
          if (stale(started)) return;
          if (error instanceof ReviewRefusedError) {
            key.current = null;
            dispatch({ type: 'REFUSED', refusal: error.refusal });
            return;
          }
          const safe = toSafeError(error);
          if (safe.code === 'auth_expired') onSessionExpired?.();
          // The key stays: a retry must not be able to move the case twice.
          dispatch({ type: 'FAILED', error: safe });
        }
      })();
    },
    [
      caseRecord.id,
      caseRecord.version,
      currentPackage,
      onSessionExpired,
      onSettled,
      random,
      scope,
      writer,
    ],
  );

  const confirm = useCallback(() => {
    if (state.name !== 'confirming') return;
    run(state.action, state.draft);
  }, [run, state]);

  const retry = useCallback(() => {
    if (state.name !== 'failed') return;
    run(state.action, state.draft);
  }, [run, state]);

  const dismiss = useCallback(() => {
    if (state.name !== 'refused' && state.name !== 'failed') return;
    key.current = null;
    dispatch({ type: 'DISMISSED' });
  }, [state.name]);

  return { state, chooseVerdict, setNote, request, cancel, confirm, retry, dismiss };
}
