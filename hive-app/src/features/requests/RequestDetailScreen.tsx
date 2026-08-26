/** Connected request detail.
 *
 * The id comes from the route and is passed to the repository as a
 * FILTER, never as scope: the query still carries the selected scope
 * triple and RLS filters ahead of it, so a foreign id yields no row and
 * the screen shows "not found here" (threat T5). */
import React, { useCallback } from 'react';

import type { RequestDetail, RequestsLoader } from '@/data/supabase/repositories';
import { useScopedLoad } from '@/features/shared/useScopedLoad';
import type { ScopeKey } from '@/tenancy/scope-key';

import { RequestDetailView } from './RequestDetailView';

export interface RequestDetailScreenProps {
  repository: RequestsLoader;
  requestId: string;
  onBack: () => void;
}

const isMissing = (request: RequestDetail | null): boolean => request === null;

export function RequestDetailScreen({
  repository,
  requestId,
  onBack,
}: RequestDetailScreenProps): React.JSX.Element | null {
  const load = useCallback(
    (scope: ScopeKey) => repository.get(scope, requestId),
    [repository, requestId],
  );
  const { scope, state, data, error, retry, switchScope } = useScopedLoad(load, isMissing);

  if (!scope) return null;

  return (
    <RequestDetailView
      state={state}
      request={data}
      error={error}
      onRetry={retry}
      onSwitchScope={switchScope}
      onBack={onBack}
    />
  );
}
