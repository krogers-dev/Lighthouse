/** The authorized Home view: the scope's cases, newest first, each with
 * one status, one attention item, and one owned next action (WO-002 R1).
 * Pure and props-driven; every screen state is explicit. No financial
 * values, no live claims, no external side effects. */
import React from 'react';
import { StyleSheet, View } from 'react-native';

import type { SafeError } from '@/core/errors';
import type { CaseSummary, ScopedList } from '@/data/supabase/repositories';
import {
  CASE_STATUS_PRESENTATION,
  OWNER_LABEL,
  formatServerTimestamp,
  recordedThroughLabel,
} from '@/features/shared/labels';
import { ScopedStates } from '@/features/shared/ScopedStates';
import type { ScopedLoadStateName } from '@/features/shared/useScopedLoad';
import { AppText, Button, EmptyState, StatusBadge, useThemeColors } from '@/ui';
import { radii, spacing } from '@/ui/tokens';

/** The dashboard shows exactly the shared scoped-load states. */
export type DashboardStateName = ScopedLoadStateName;

export interface DashboardViewProps {
  state: DashboardStateName;
  workspaceName: string;
  data?: ScopedList<CaseSummary>;
  error?: SafeError;
  onRetry: () => void;
  onSwitchScope?: () => void;
}

const styles = StyleSheet.create({
  container: { gap: spacing.lg },
  list: { gap: spacing.sm },
  card: {
    borderRadius: radii.lg,
    borderWidth: 1,
    padding: spacing.md,
    gap: spacing.sm,
  },
  block: { gap: spacing.xs },
});

function CaseCard({ item }: { item: CaseSummary }): React.JSX.Element {
  const colors = useThemeColors();
  const presentation = CASE_STATUS_PRESENTATION[item.status];
  return (
    <View
      style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.divider }]}
      testID={`dashboard-case-${item.id}`}
    >
      <AppText variant="heading">{item.title}</AppText>
      <StatusBadge kind={presentation.kind} label={presentation.label} />
      <AppText variant="caption" tone="secondary">
        {`Status changed ${formatServerTimestamp(item.statusChangedAt)}`}
      </AppText>
      {item.attentionSummary ? (
        <View style={styles.block}>
          <AppText variant="label">Needs attention</AppText>
          <AppText variant="body">{item.attentionSummary}</AppText>
        </View>
      ) : (
        <AppText variant="body" tone="secondary">
          Nothing is waiting on you right now.
        </AppText>
      )}
      {item.nextActionSummary ? (
        <View style={styles.block}>
          <AppText variant="label">Next action</AppText>
          <AppText variant="body">{item.nextActionSummary}</AppText>
          {item.nextActionOwnerRole ? (
            <AppText variant="caption" tone="secondary">
              {`Owner: ${OWNER_LABEL[item.nextActionOwnerRole]}`}
            </AppText>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

export function DashboardView({
  state,
  workspaceName,
  data,
  error,
  onRetry,
  onSwitchScope,
}: DashboardViewProps): React.JSX.Element {
  const recordedThrough = recordedThroughLabel(data?.recordedThrough ?? null);
  return (
    <View style={styles.container} testID="dashboard">
      <AppText variant="title" accessibilityRole="header">
        Home
      </AppText>
      <AppText variant="body" tone="secondary" testID="dashboard-workspace">
        {workspaceName}
      </AppText>

      <ScopedStates
        state={state}
        testIDPrefix="dashboard"
        loadingLabel="Loading your view"
        error={error}
        onRetry={onRetry}
        onSwitchScope={onSwitchScope}
      />

      {state === 'empty' ? (
        <EmptyState
          title="Nothing needs your attention"
          body="There is no open work in this workspace right now. We will surface anything that needs you here."
          testID="dashboard-empty"
        />
      ) : null}

      {state === 'ready' && data ? (
        <View style={styles.list} testID="dashboard-list">
          {data.items.map((item) => (
            <CaseCard key={item.id} item={item} />
          ))}
        </View>
      ) : null}

      {/* R7: a reload affordance on the screen itself, not only inside an
          error state. There is no background polling, so this is the only
          way content refreshes. */}
      {state === 'ready' || state === 'empty' ? (
        <View style={styles.block}>
          {recordedThrough ? (
            <AppText variant="caption" tone="secondary" testID="dashboard-recorded-through">
              {recordedThrough}
            </AppText>
          ) : null}
          <Button kind="secondary" label="Refresh" onPress={onRetry} testID="dashboard-refresh" />
        </View>
      ) : null}
    </View>
  );
}
