/** The authorized Home view: one status, one attention item, one next
 * action. Pure and props-driven; every screen state is explicit. No
 * financial values, no live claims, no external side effects. */
import React from 'react';
import { StyleSheet, View } from 'react-native';

import type { SafeError } from '@/core/errors';
import type { CaseStatus, DashboardSnapshot } from '@/data/supabase/repositories';
import type { MembershipRole } from '@/tenancy/types';
import {
  AppText,
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  OfflineState,
  StatusBadge,
  useThemeColors,
} from '@/ui';
import { radii, spacing } from '@/ui/tokens';
import type { StatusKind } from '@/ui/primitives/StatusBadge';

export type DashboardStateName =
  | 'loading'
  | 'ready'
  | 'empty'
  | 'offline'
  | 'expired'
  | 'denied'
  | 'stale_scope'
  | 'error';

export interface DashboardViewProps {
  state: DashboardStateName;
  workspaceName: string;
  snapshot?: DashboardSnapshot;
  error?: SafeError;
  onRetry: () => void;
  onSwitchScope?: () => void;
  onOpenSettings: () => void;
}

const styles = StyleSheet.create({
  container: { gap: spacing.lg },
  card: {
    borderRadius: radii.lg,
    padding: spacing.md,
    gap: spacing.sm,
  },
});

const STATUS_PRESENTATION: Record<CaseStatus, { kind: StatusKind; label: string }> = {
  DRAFT: { kind: 'neutral', label: 'Being set up' },
  INTAKE_RECORDED: { kind: 'neutral', label: 'Received' },
  EVIDENCE_PENDING: { kind: 'attention', label: 'Waiting on records' },
  READY_FOR_REVIEW: { kind: 'neutral', label: 'Ready for review' },
  IN_REVIEW: { kind: 'neutral', label: 'In review' },
  APPROVAL_PENDING: { kind: 'neutral', label: 'Awaiting approval' },
  APPROVED: { kind: 'stable', label: 'Approved' },
  RETURNED: { kind: 'attention', label: 'Needs another pass' },
  HOLD: { kind: 'blocked', label: 'On hold' },
};

const OWNER_LABEL: Record<MembershipRole, string> = {
  client_user: 'You',
  intake: 'Honeybee intake',
  preparer: 'Your preparer',
  reviewer: 'Reviewer',
  approver: 'Approver',
};

export function DashboardView({
  state,
  workspaceName,
  snapshot,
  error,
  onRetry,
  onSwitchScope,
  onOpenSettings,
}: DashboardViewProps): React.JSX.Element {
  const colors = useThemeColors();
  return (
    <View style={styles.container} testID="dashboard">
      <AppText variant="title" accessibilityRole="header">
        Home
      </AppText>
      <AppText variant="body" tone="secondary" testID="dashboard-workspace">
        {workspaceName}
      </AppText>

      {state === 'loading' ? <LoadingState label="Loading your view" testID="dashboard-loading" /> : null}

      {state === 'offline' ? <OfflineState onRetry={onRetry} testID="dashboard-offline" /> : null}

      {state === 'expired' ? (
        <EmptyState
          title="Session ended"
          body="Your session ended. Sign in again to continue."
          testID="dashboard-expired"
        />
      ) : null}

      {state === 'denied' ? (
        <EmptyState
          title="No access to this workspace"
          body="Your access here has changed. If this seems wrong, contact Honeybee Accounting."
          actionLabel={onSwitchScope ? 'Choose a workspace' : undefined}
          onAction={onSwitchScope}
          testID="dashboard-denied"
        />
      ) : null}

      {state === 'stale_scope' ? (
        <EmptyState
          title="Your access changed"
          body="This workspace is no longer available to you. Choose a workspace to continue."
          actionLabel={onSwitchScope ? 'Choose a workspace' : undefined}
          onAction={onSwitchScope}
          testID="dashboard-stale"
        />
      ) : null}

      {state === 'error' && error ? (
        <ErrorState error={error} onRetry={onRetry} testID="dashboard-error" />
      ) : null}

      {state === 'empty' ? (
        <EmptyState
          title="Nothing needs your attention"
          body="There is no open work in this workspace right now. We will surface anything that needs you here."
          testID="dashboard-empty"
        />
      ) : null}

      {state === 'ready' && snapshot && snapshot.caseStatus ? (
        <View
          style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.divider, borderWidth: 1 }]}
          testID="dashboard-ready"
        >
          <AppText variant="heading">{snapshot.caseTitle ?? 'Current work'}</AppText>
          <StatusBadge
            kind={STATUS_PRESENTATION[snapshot.caseStatus].kind}
            label={STATUS_PRESENTATION[snapshot.caseStatus].label}
            testID="dashboard-status"
          />
          {snapshot.attentionSummary ? (
            <View>
              <AppText variant="label">Needs attention</AppText>
              <AppText variant="body">{snapshot.attentionSummary}</AppText>
            </View>
          ) : (
            <AppText variant="body" tone="secondary">
              Nothing is waiting on you right now.
            </AppText>
          )}
          {snapshot.nextActionSummary ? (
            <View>
              <AppText variant="label">Next action</AppText>
              <AppText variant="body">{snapshot.nextActionSummary}</AppText>
              {snapshot.nextActionOwnerRole ? (
                <AppText variant="caption" tone="secondary">
                  {`Owner: ${OWNER_LABEL[snapshot.nextActionOwnerRole]}`}
                </AppText>
              ) : null}
            </View>
          ) : null}
        </View>
      ) : null}

      <Button kind="secondary" label="Account" onPress={onOpenSettings} testID="dashboard-account" />
    </View>
  );
}
