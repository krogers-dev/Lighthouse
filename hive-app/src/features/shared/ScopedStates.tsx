/** Every non-ready state a scope-bound read screen can show.
 *
 * Rendered from one place so the wording, the recovery affordances, and
 * the rule that offline REPLACES content rather than ageing it (threat
 * T4) cannot drift apart between Home, Requests, and Activity. Returns
 * null in the ready and empty states: those are the screen's own content
 * to render, because only the screen knows what "nothing here" means.
 */
import React from 'react';

import type { SafeError } from '@/core/errors';
import { EmptyState, ErrorState, LoadingState, OfflineState } from '@/ui';

import type { ScopedLoadStateName } from './useScopedLoad';

export interface ScopedStatesProps {
  state: ScopedLoadStateName;
  /** Prefixes every testID, e.g. "requests" -> "requests-loading". */
  testIDPrefix: string;
  loadingLabel: string;
  error?: SafeError;
  onRetry: () => void;
  onSwitchScope?: () => void;
}

export function ScopedStates({
  state,
  testIDPrefix,
  loadingLabel,
  error,
  onRetry,
  onSwitchScope,
}: ScopedStatesProps): React.JSX.Element | null {
  if (state === 'loading') {
    return <LoadingState label={loadingLabel} testID={`${testIDPrefix}-loading`} />;
  }
  if (state === 'offline') {
    return <OfflineState onRetry={onRetry} testID={`${testIDPrefix}-offline`} />;
  }
  if (state === 'expired') {
    return (
      <EmptyState
        title="Session ended"
        body="Your session ended. Sign in again to continue."
        testID={`${testIDPrefix}-expired`}
      />
    );
  }
  if (state === 'denied') {
    return (
      <EmptyState
        title="No access to this workspace"
        body="Your access here has changed. If this seems wrong, contact Honeybee Accounting."
        actionLabel={onSwitchScope ? 'Choose a workspace' : undefined}
        onAction={onSwitchScope}
        testID={`${testIDPrefix}-denied`}
      />
    );
  }
  if (state === 'stale_scope') {
    return (
      <EmptyState
        title="Your access changed"
        body="This workspace is no longer available to you. Choose a workspace to continue."
        actionLabel={onSwitchScope ? 'Choose a workspace' : undefined}
        onAction={onSwitchScope}
        testID={`${testIDPrefix}-stale`}
      />
    );
  }
  if (state === 'error' && error) {
    return <ErrorState error={error} onRetry={onRetry} testID={`${testIDPrefix}-error`} />;
  }
  return null;
}
