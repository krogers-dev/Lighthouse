/** Connected dashboard container: binds the authorized scope to the
 * repository, drives explicit screen states, and reports expiry back to
 * the auth controller. Storage quarantine is handled globally by the route
 * guard (the quarantine route), never here.
 *
 * The scope binding, cancellation, and error mapping live in
 * useScopedLoad, shared with the Milestone 1 read screens. */
import React, { useCallback } from 'react';

import type { CaseSummary, DashboardLoader, ScopedList } from '@/data/supabase/repositories';
import { useScopedLoad } from '@/features/shared/useScopedLoad';
import type { ScopeKey } from '@/tenancy/scope-key';

import { DashboardView } from './DashboardView';

export interface DashboardScreenProps {
  repository: DashboardLoader;
}

const isEmpty = (list: ScopedList<CaseSummary>): boolean => list.items.length === 0;

export function DashboardScreen({ repository }: DashboardScreenProps): React.JSX.Element | null {
  const load = useCallback((scope: ScopeKey) => repository.load(scope), [repository]);
  const { scope, state, data, error, workspaceName, retry, switchScope } = useScopedLoad(
    load,
    isEmpty,
  );

  if (!scope) return null;

  return (
    <DashboardView
      state={state}
      workspaceName={workspaceName}
      data={data}
      error={error}
      onRetry={retry}
      onSwitchScope={switchScope}
    />
  );
}
