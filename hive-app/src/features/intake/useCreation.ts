/** useCreation: drives one creation (a case, a request) against a writer.
 *
 * The reducer (intake-flow.ts) owns what the screen shows; this hook owns
 * the creation's idempotency key: made when the person asks to confirm,
 * kept through a transient failure so "try again" can never create
 * twice, and dropped when the creation settles, is canceled, or is
 * dismissed. A late result from a step the person has moved past is
 * dropped by epoch (P2-9).
 */
import { useCallback, useEffect, useReducer, useRef } from 'react';

import { toSafeError } from '@/core/errors';
import { type RandomSource, cryptoRandomSource, newUuid } from '@/core/ids';
import { ReviewRefusedError } from '@/data/supabase/reviews';

import { type CreationState, creationReducer, initialCreationState } from './intake-flow';
import type { IntakeLocalRefusal } from './intake-rules';

export interface CreationDeps<D, R> {
  initialDraft: D;
  /** What must hold before any round trip; null when the draft is sendable. */
  check: (draft: D) => IntakeLocalRefusal | null;
  /** The round trip, with the key made once per confirmation. */
  create: (draft: D, idempotencyKey: string) => Promise<R>;
  random?: RandomSource;
  onSessionExpired?: () => void;
  onCreated?: (result: R) => void;
}

export interface CreationController<D, R> {
  readonly state: CreationState<D, R>;
  setDraft: (draft: D) => void;
  request: () => void;
  cancel: () => void;
  confirm: () => void;
  retry: () => void;
  dismiss: () => void;
}

export function useCreation<D, R>(deps: CreationDeps<D, R>): CreationController<D, R> {
  const {
    initialDraft,
    check,
    create,
    random = cryptoRandomSource,
    onSessionExpired,
    onCreated,
  } = deps;
  const [state, dispatch] = useReducer(
    creationReducer<D, R>,
    initialDraft,
    initialCreationState<D, R>,
  );
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

  const setDraft = useCallback((draft: D) => {
    dispatch({ type: 'DRAFT_CHANGED', draft });
  }, []);

  const request = useCallback(() => {
    if (state.name !== 'idle') return;
    const refusal = check(state.draft);
    if (refusal) {
      dispatch({ type: 'LOCALLY_REFUSED', refusal });
      return;
    }
    key.current = newUuid(random);
    dispatch({ type: 'CONFIRM_REQUESTED' });
  }, [check, random, state]);

  const cancel = useCallback(() => {
    if (state.name !== 'confirming') return;
    key.current = null;
    dispatch({ type: 'CANCELED' });
  }, [state.name]);

  const run = useCallback(
    (draft: D) => {
      const idempotencyKey = key.current ?? newUuid(random);
      key.current = idempotencyKey;
      const started = ++epoch.current;
      dispatch({ type: 'STARTED' });
      void (async () => {
        try {
          const result = await create(draft, idempotencyKey);
          if (stale(started)) return;
          key.current = null;
          dispatch({ type: 'SUCCEEDED', result });
          onCreated?.(result);
        } catch (error) {
          if (stale(started)) return;
          if (error instanceof ReviewRefusedError) {
            key.current = null;
            dispatch({ type: 'REFUSED', refusal: error.refusal });
            return;
          }
          const safe = toSafeError(error);
          if (safe.code === 'auth_expired') onSessionExpired?.();
          // The key stays: a retry must not be able to create twice.
          dispatch({ type: 'FAILED', error: safe });
        }
      })();
    },
    [create, onCreated, onSessionExpired, random],
  );

  const confirm = useCallback(() => {
    if (state.name !== 'confirming') return;
    run(state.draft);
  }, [run, state]);

  const retry = useCallback(() => {
    if (state.name !== 'failed') return;
    run(state.draft);
  }, [run, state]);

  const dismiss = useCallback(() => {
    if (state.name !== 'refused' && state.name !== 'failed') return;
    key.current = null;
    dispatch({ type: 'DISMISSED' });
  }, [state.name]);

  return { state, setDraft, request, cancel, confirm, retry, dismiss };
}
