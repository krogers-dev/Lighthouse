/** The authorized Home view: the scope's cases, newest first, each with
 * one status, one attention item, and one owned next action (WO-002 R1).
 * Pure and props-driven; every screen state is explicit. No financial
 * values, no live claims, no external side effects.
 *
 * Presentation (HIVE 2026 design, 2026-09-07): case rows separated by
 * thin rules rather than boxed cards, the title first, then the exact
 * status, the attention item, the named next action, the owner, and the
 * source dates. Rows are read-only; nothing here is pressable. */
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
import { layout, spacing } from '@/ui/tokens';

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
  heading: { gap: spacing.xs },
  list: {},
  row: {
    paddingVertical: spacing.md,
    gap: spacing.sm,
    borderTopWidth: layout.hairline,
  },
  block: { gap: spacing.xs },
  footer: {
    gap: spacing.sm,
    paddingTop: spacing.md,
    borderTopWidth: layout.hairline,
  },
});

function CaseRow({ item }: { item: CaseSummary }): React.JSX.Element {
  const colors = useThemeColors();
  const presentation = CASE_STATUS_PRESENTATION[item.status];
  return (
    <View
      style={[styles.row, { borderTopColor: colors.divider }]}
      testID={`dashboard-case-${item.id}`}
    >
      <AppText variant="heading">{item.title}</AppText>
      <StatusBadge kind={presentation.kind} label={presentation.label} />
      <AppText variant="caption" tone="secondary">
        {`Status changed ${formatServerTimestamp(item.statusChangedAt)}`}
      </AppText>
      {item.attentionSummary ? (
        <View style={styles.block}>
          <AppText variant="labelSmall">Needs attention</AppText>
          <AppText variant="body">{item.attentionSummary}</AppText>
        </View>
      ) : (
        <AppText variant="caption" tone="secondary">
          Nothing is waiting on you right now.
        </AppText>
      )}
      {item.nextActionSummary ? (
        <View style={styles.block}>
          <AppText variant="labelSmall">Next action</AppText>
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
  const colors = useThemeColors();
  const recordedThrough = recordedThroughLabel(data?.recordedThrough ?? null);
  return (
    <View style={styles.container} testID="dashboard">
      <View style={styles.heading}>
        <AppText variant="title" accessibilityRole="header">
          Home
        </AppText>
        <AppText variant="caption" tone="secondary" testID="dashboard-workspace">
          {workspaceName}
        </AppText>
      </View>

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
          body="There is no open work in this workspace right now. Anything that needs you will show up here."
          testID="dashboard-empty"
        />
      ) : null}

      {state === 'ready' && data ? (
        <View style={styles.list} testID="dashboard-list">
          {data.items.map((item) => (
            <CaseRow key={item.id} item={item} />
          ))}
        </View>
      ) : null}

      {/* R7: a reload affordance on the screen itself, not only inside an
          error state. There is no background polling, so this is the only
          way content refreshes. */}
      {state === 'ready' || state === 'empty' ? (
        <View style={[styles.footer, { borderTopColor: colors.divider }]}>
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
