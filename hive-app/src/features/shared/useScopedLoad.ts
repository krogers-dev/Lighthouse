/** One scope-bound read, with the P2-9 contract enforced in a single
 * place.
 *
 * Milestone 1 adds three more screens that all read within a selected
 * scope. Copying the dashboard's load logic into each one is how the
 * subtle parts quietly rot: the derived-state reset that must happen
 * during render (not in an effect, or stale content flashes), the
 * cancellation that must survive BOTH scope and membership switches, and
 * the error mapping that must route an expired session back into the auth
 * controller rather than showing a dead screen.
 *
 * `load` is used as an effect dependency, so callers must memoize it
 * (useCallback) or the read will loop.
 */
import { useCallback, useEffect, useState } from 'react';

import { useAuthController, useAuthState } from '@/auth/provider';
import { SafeError } from '@/core/errors';
import type { ScopeKey } from '@/tenancy/scope-key';
import { scopeKeyToken } from '@/tenancy/scope-key';

export type ScopedLoadStateName =
  'loading' | 'ready' | 'empty' | 'offline' | 'expired' | 'denied' | 'stale_scope' | 'error';

export interface ScopedLoad<T> {
  /** Null until the session is authorized; screens render nothing then. */
  scope: ScopeKey | null;
  state: ScopedLoadStateName;
  data?: T;
  error?: SafeError;
  workspaceName: string;
  canSwitchScope: boolean;
  retry: () => void;
  switchScope: () => void;
}

export function useScopedLoad<T>(
  load: (scope: ScopeKey) => Promise<T>,
  isEmpty: (value: T) => boolean,
): ScopedLoad<T> {
  const state = useAuthState();
  const controller = useAuthController();
  const [result, setResult] = useState<{
    name: ScopedLoadStateName;
    data?: T;
    error?: SafeError;
  }>({ name: 'loading' });
  const [reloadNonce, setReloadNonce] = useState(0);
  const [activeRequestKey, setActiveRequestKey] = useState<string | null>(null);

  const authorized = state.name === 'authorized' ? state : null;
  const scope = authorized?.scope ?? null;
  const requestKey = scope ? `${scopeKeyToken(scope)}:${reloadNonce}` : null;
  // A membership revoked underneath the selected scope is stale scope, not
  // a failed read: the screen must say so rather than showing old rows.
  const membershipStillValid =
    authorized === null ||
    authorized.memberships.some((m) => m.membershipId === authorized.scope.membershipId);

  // Derived-state reset during render, never inside an effect: a new scope
  // or a retry shows loading immediately, so content from the previous
  // scope cannot flash before the effect runs.
  if (requestKey !== activeRequestKey) {
    setActiveRequestKey(requestKey);
    setResult({ name: 'loading' });
  }

  useEffect(() => {
    if (!scope || requestKey === null) return;
    let cancelled = false;
    load(scope)
      .then((value) => {
        if (cancelled) return;
        setResult(isEmpty(value) ? { name: 'empty', data: value } : { name: 'ready', data: value });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const safe = error instanceof SafeError ? error : new SafeError('unknown');
        if (safe.code === 'auth_expired') {
          setResult({ name: 'expired' });
          void controller.sessionExpired();
        } else if (safe.code === 'denied' || safe.code === 'stale_scope') {
          setResult({ name: safe.code === 'denied' ? 'denied' : 'stale_scope' });
        } else if (safe.code === 'network' || safe.code === 'offline') {
          setResult({ name: 'offline' });
        } else {
          setResult({ name: 'error', error: safe });
        }
      });
    return () => {
      cancelled = true;
    };
    // isEmpty is a pure predicate; including it would force callers to
    // memoize a trivial function for no behavioral gain.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, controller, scope, requestKey]);

  const retry = useCallback(() => setReloadNonce((n) => n + 1), []);
  const switchScope = useCallback(() => void controller.switchScope(), [controller]);

  const workspaceName =
    (authorized &&
      authorized.memberships.find((m) => m.membershipId === authorized.scope.membershipId)
        ?.entityName) ||
    'Workspace';

  return {
    scope,
    state: membershipStillValid ? result.name : 'stale_scope',
    data: result.data,
    error: result.error,
    workspaceName,
    canSwitchScope: (authorized?.memberships.length ?? 0) > 1,
    retry,
    switchScope,
  };
}
