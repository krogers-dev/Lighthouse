/** useDeletionRequest: the person's deletion request on the Account
 * screen (WO-007).
 *
 * Loads the latest request when enabled (the deletion control exists
 * only when the public deletion page is configured, and only in the
 * authorized state); drives one action at a time through the reducer in
 * deletion-flow.ts; owns the idempotency key exactly as the other
 * transitions do (made at the request, kept through a transient failure,
 * dropped when settled, canceled, or dismissed); reloads after a settled
 * action; drops late results by epoch. */
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';

import { type SafeError, toSafeError } from '@/core/errors';
import { type RandomSource, cryptoRandomSource, newUuid } from '@/core/ids';
import {
  type AccountLoader,
  AccountRefusedError,
  type AccountWriter,
  type DeletionRequest,
} from '@/data/supabase/account';

import {
  type DeletionAction,
  type DeletionFlowState,
  deletionReducer,
  initialDeletionState,
} from './deletion-flow';

export type DeletionLoadState =
  | { readonly name: 'disabled' }
  | { readonly name: 'loading' }
  | { readonly name: 'ready'; readonly latest: DeletionRequest | null }
  | { readonly name: 'error'; readonly error: SafeError };

export interface DeletionRequestDeps {
  account: AccountLoader & AccountWriter;
  enabled: boolean;
  random?: RandomSource;
  onSessionExpired?: () => void;
}

export interface DeletionRequestController {
  readonly load: DeletionLoadState;
  readonly flow: DeletionFlowState;
  reload: () => void;
  request: (action: DeletionAction) => void;
  cancel: () => void;
  confirm: () => void;
  retry: () => void;
  dismiss: () => void;
}

export function useDeletionRequest(deps: DeletionRequestDeps): DeletionRequestController {
  const { account, enabled, random = cryptoRandomSource, onSessionExpired } = deps;
  const [load, setLoad] = useState<DeletionLoadState>(() =>
    enabled ? { name: 'loading' } : { name: 'disabled' },
  );
  const [flow, dispatch] = useReducer(deletionReducer, initialDeletionState);
  const key = useRef<string | null>(null);
  const epoch = useRef(0);
  const mounted = useRef(true);

  const stale = (started: number): boolean => started !== epoch.current || !mounted.current;

  /** The read itself: state is written only once the server answers, so
   * the mount effect never writes state synchronously. */
  const fetchLatest = useCallback(() => {
    const started = ++epoch.current;
    void account
      .getLatestDeletionRequest()
      .then((latest) => {
        if (stale(started)) return;
        setLoad({ name: 'ready', latest });
      })
      .catch((error: unknown) => {
        if (stale(started)) return;
        const safe = toSafeError(error);
        if (safe.code === 'auth_expired') onSessionExpired?.();
        setLoad({ name: 'error', error: safe });
      });
  }, [account, onSessionExpired]);

  const reload = useCallback(() => {
    if (!enabled) {
      setLoad({ name: 'disabled' });
      return;
    }
    setLoad({ name: 'loading' });
    fetchLatest();
  }, [enabled, fetchLatest]);

  useEffect(() => {
    mounted.current = true;
    if (enabled) fetchLatest();
    return () => {
      mounted.current = false;
      epoch.current += 1;
      key.current = null;
    };
  }, [enabled, fetchLatest]);

  const request = useCallback(
    (action: DeletionAction) => {
      if (flow.name !== 'idle') return;
      key.current = newUuid(random);
      dispatch({ type: 'ACTION_REQUESTED', action });
    },
    [flow.name, random],
  );

  const cancel = useCallback(() => {
    if (flow.name !== 'confirming') return;
    key.current = null;
    dispatch({ type: 'CANCELED' });
  }, [flow.name]);

  const run = useCallback(
    (action: DeletionAction) => {
      const idempotencyKey = key.current ?? newUuid(random);
      key.current = idempotencyKey;
      const started = ++epoch.current;
      dispatch({ type: 'STARTED' });
      void (async () => {
        try {
          const receipt =
            action === 'request'
              ? await account.requestDeletion(idempotencyKey)
              : await account.withdrawDeletion(idempotencyKey);
          if (stale(started)) return;
          key.current = null;
          dispatch({ type: 'SUCCEEDED', receipt });
          // The screen shows what the server now holds; the person
          // dismisses the confirmation when read.
          reload();
        } catch (error) {
          if (stale(started)) return;
          if (error instanceof AccountRefusedError) {
            key.current = null;
            dispatch({ type: 'REFUSED', refusal: error.refusal });
            return;
          }
          const safe = toSafeError(error);
          if (safe.code === 'auth_expired') onSessionExpired?.();
          // The key stays: a retry must not be able to ask twice.
          dispatch({ type: 'FAILED', error: safe });
        }
      })();
    },
    [account, onSessionExpired, random, reload],
  );

  const confirm = useCallback(() => {
    if (flow.name !== 'confirming') return;
    run(flow.action);
  }, [flow, run]);

  const retry = useCallback(() => {
    if (flow.name !== 'failed') return;
    run(flow.action);
  }, [flow, run]);

  const dismiss = useCallback(() => {
    if (flow.name !== 'refused' && flow.name !== 'failed' && flow.name !== 'done') return;
    key.current = null;
    dispatch({ type: 'DISMISSED' });
  }, [flow.name]);

  return { load, flow, reload, request, cancel, confirm, retry, dismiss };
}
