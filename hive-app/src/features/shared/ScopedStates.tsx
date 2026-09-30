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

/** Every state testID, written out as a literal.
 *
 * Built from a template literal these would be invisible to
 * maestro:validate, which proves that each flow selector matches a testID
 * that actually exists in the sources — a device flow could then reference
 * an id no screen renders and still pass validation. One table also makes
 * the whole ID surface auditable in a single place. */
export const SCOPED_STATE_TEST_IDS = {
  dashboard: {
    loading: 'dashboard-loading',
    offline: 'dashboard-offline',
    expired: 'dashboard-expired',
    denied: 'dashboard-denied',
    stale: 'dashboard-stale',
    error: 'dashboard-error',
  },
  requests: {
    loading: 'requests-loading',
    offline: 'requests-offline',
    expired: 'requests-expired',
    denied: 'requests-denied',
    stale: 'requests-stale',
    error: 'requests-error',
  },
  'request-detail': {
    loading: 'request-detail-loading',
    offline: 'request-detail-offline',
    expired: 'request-detail-expired',
    denied: 'request-detail-denied',
    stale: 'request-detail-stale',
    error: 'request-detail-error',
  },
  activity: {
    loading: 'activity-loading',
    offline: 'activity-offline',
    expired: 'activity-expired',
    denied: 'activity-denied',
    stale: 'activity-stale',
    error: 'activity-error',
  },
  'add-document': {
    loading: 'add-document-loading',
    offline: 'add-document-offline',
    expired: 'add-document-expired',
    denied: 'add-document-denied',
    stale: 'add-document-stale',
    error: 'add-document-error',
  },
  respond: {
    loading: 'respond-loading',
    offline: 'respond-offline',
    expired: 'respond-expired',
    denied: 'respond-denied',
    stale: 'respond-stale',
    error: 'respond-error',
  },
  'case-review': {
    loading: 'case-review-loading',
    offline: 'case-review-offline',
    expired: 'case-review-expired',
    denied: 'case-review-denied',
    stale: 'case-review-stale',
    error: 'case-review-error',
  },
} as const;

export type ScopedStatesSurface = keyof typeof SCOPED_STATE_TEST_IDS;

export interface ScopedStatesProps {
  state: ScopedLoadStateName;
  /** Which screen's testID set to use. */
  testIDPrefix: ScopedStatesSurface;
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
  const testIDs = SCOPED_STATE_TEST_IDS[testIDPrefix];
  if (state === 'loading') {
    return <LoadingState label={loadingLabel} testID={testIDs.loading} />;
  }
  if (state === 'offline') {
    return <OfflineState onRetry={onRetry} testID={testIDs.offline} />;
  }
  if (state === 'expired') {
    return (
      <EmptyState
        title="Session ended"
        body="Your session ended. Sign in again to continue."
        testID={testIDs.expired}
      />
    );
  }
  if (state === 'denied') {
    return (
      <EmptyState
        title="No access to this workspace"
        body="Your access here has changed. If this seems wrong, contact your Honeybee team."
        actionLabel={onSwitchScope ? 'Choose a workspace' : undefined}
        onAction={onSwitchScope}
        testID={testIDs.denied}
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
        testID={testIDs.stale}
      />
    );
  }
  if (state === 'error' && error) {
    return <ErrorState error={error} onRetry={onRetry} testID={testIDs.error} />;
  }
  return null;
}
