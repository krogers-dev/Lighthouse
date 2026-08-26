/** Connected requests list. Scope binding, cancellation, and error
 * mapping come from useScopedLoad, shared with Home and Activity. */
import React, { useCallback } from 'react';

import type { RequestSummary, RequestsLoader, ScopedList } from '@/data/supabase/repositories';
import { useScopedLoad } from '@/features/shared/useScopedLoad';
import type { ScopeKey } from '@/tenancy/scope-key';

import { RequestsView } from './RequestsView';

export interface RequestsScreenProps {
  repository: RequestsLoader;
  onOpenRequest: (requestId: string) => void;
}

const isEmpty = (list: ScopedList<RequestSummary>): boolean => list.items.length === 0;

export function RequestsScreen({
  repository,
  onOpenRequest,
}: RequestsScreenProps): React.JSX.Element | null {
  const load = useCallback((scope: ScopeKey) => repository.list(scope), [repository]);
  const { scope, state, data, error, workspaceName, retry, switchScope } = useScopedLoad(
    load,
    isEmpty,
  );

  if (!scope) return null;

  return (
    <RequestsView
      state={state}
      workspaceName={workspaceName}
      data={data}
      error={error}
      onRetry={retry}
      onSwitchScope={switchScope}
      onOpenRequest={onOpenRequest}
    />
  );
}
