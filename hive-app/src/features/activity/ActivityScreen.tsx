/** Connected activity trail. */
import React, { useCallback } from 'react';

import type { ActivityEntry, ActivityLoader, ScopedList } from '@/data/supabase/repositories';
import { useScopedLoad } from '@/features/shared/useScopedLoad';
import type { ScopeKey } from '@/tenancy/scope-key';

import { ActivityView } from './ActivityView';

export interface ActivityScreenProps {
  repository: ActivityLoader;
}

const isEmpty = (list: ScopedList<ActivityEntry>): boolean => list.items.length === 0;

export function ActivityScreen({ repository }: ActivityScreenProps): React.JSX.Element | null {
  const load = useCallback((scope: ScopeKey) => repository.list(scope), [repository]);
  const { scope, state, data, error, workspaceName, retry, switchScope } = useScopedLoad(
    load,
    isEmpty,
  );

  if (!scope) return null;

  return (
    <ActivityView
      state={state}
      workspaceName={workspaceName}
      data={data}
      error={error}
      onRetry={retry}
      onSwitchScope={switchScope}
    />
  );
}
