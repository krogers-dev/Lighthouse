/** Connected dashboard container: binds the authorized scope to the
 * repository, drives explicit screen states, and reports expiry back to
 * the auth controller. Storage quarantine is handled globally by the route
 * guard (the quarantine route), never here. */
import React, { useCallback, useEffect, useState } from 'react';

import { useAuthController, useAuthState } from '@/auth/provider';
import { SafeError } from '@/core/errors';
import type { DashboardLoader, DashboardSnapshot } from '@/data/supabase/repositories';
import { scopeKeyToken } from '@/tenancy/scope-key';

import { DashboardView, type DashboardStateName } from './DashboardView';

export interface DashboardScreenProps {
  repository: DashboardLoader;
  onOpenSettings: () => void;
}

interface LoadState {
  name: DashboardStateName;
  snapshot?: DashboardSnapshot;
  error?: SafeError;
}

export function DashboardScreen({
  repository,
  onOpenSettings,
}: DashboardScreenProps): React.JSX.Element | null {
  const state = useAuthState();
  const controller = useAuthController();
  const [load, setLoad] = useState<LoadState>({ name: 'loading' });
  const [reloadNonce, setReloadNonce] = useState(0);
  const [activeRequestKey, setActiveRequestKey] = useState<string | null>(null);

  const authorized = state.name === 'authorized' ? state : null;
  const scope = authorized?.scope ?? null;
  const requestKey = scope ? `${scopeKeyToken(scope)}:${reloadNonce}` : null;
  const membershipStillValid =
    authorized === null ||
    authorized.memberships.some((m) => m.membershipId === authorized.scope.membershipId);

  // Derived-state reset during render (never inside an effect): a new scope
  // or retry immediately shows loading, so stale content cannot flash.
  if (requestKey !== activeRequestKey) {
    setActiveRequestKey(requestKey);
    setLoad({ name: 'loading' });
  }

  useEffect(() => {
    if (!scope || requestKey === null) return;
    let cancelled = false;
    repository
      .load(scope)
      .then((snapshot) => {
        if (cancelled) return;
        setLoad(
          snapshot.caseStatus === null ? { name: 'empty' } : { name: 'ready', snapshot },
        );
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const safe = error instanceof SafeError ? error : new SafeError('unknown');
        if (safe.code === 'auth_expired') {
          setLoad({ name: 'expired' });
          void controller.sessionExpired();
        } else if (safe.code === 'denied' || safe.code === 'stale_scope') {
          setLoad({ name: safe.code === 'denied' ? 'denied' : 'stale_scope' });
        } else if (safe.code === 'network' || safe.code === 'offline') {
          setLoad({ name: 'offline' });
        } else {
          setLoad({ name: 'error', error: safe });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [repository, controller, scope, requestKey]);

  const retry = useCallback(() => setReloadNonce((n) => n + 1), []);
  const switchScope = useCallback(() => void controller.switchScope(), [controller]);

  if (!authorized || !scope) return null;

  const workspaceName =
    authorized.memberships.find((m) => m.membershipId === scope.membershipId)?.entityName ??
    'Workspace';

  return (
    <DashboardView
      state={membershipStillValid ? load.name : 'stale_scope'}
      workspaceName={workspaceName}
      snapshot={load.snapshot}
      error={load.error}
      onRetry={retry}
      onSwitchScope={switchScope}
      onOpenSettings={onOpenSettings}
    />
  );
}
