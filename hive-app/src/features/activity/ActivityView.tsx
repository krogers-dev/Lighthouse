/** Activity: a bounded, append-only trail of what has happened in this
 * workspace (WO-002 R3).
 *
 * Each entry is an enumerated event kind, an acting ROLE, and a server
 * date — never a personal name, a filename, or a value. That is enforced
 * by the schema (activity_events has no free-text column), so this screen
 * cannot render something the database was never able to hold. */
import React from 'react';
import { StyleSheet, View } from 'react-native';

import type { SafeError } from '@/core/errors';
import type { ActivityEntry, ScopedList } from '@/data/supabase/repositories';
import {
  ACTIVITY_KIND_LABEL,
  ACTOR_LABEL,
  formatServerTimestamp,
  recordedThroughLabel,
} from '@/features/shared/labels';
import { ScopedStates } from '@/features/shared/ScopedStates';
import type { ScopedLoadStateName } from '@/features/shared/useScopedLoad';
import { AppText, EmptyState, useThemeColors } from '@/ui';
import { radii, spacing } from '@/ui/tokens';

export interface ActivityViewProps {
  state: ScopedLoadStateName;
  workspaceName: string;
  data?: ScopedList<ActivityEntry>;
  error?: SafeError;
  onRetry: () => void;
  onSwitchScope?: () => void;
}

const styles = StyleSheet.create({
  container: { gap: spacing.lg },
  list: { gap: spacing.sm },
  entry: {
    borderRadius: radii.md,
    borderWidth: 1,
    padding: spacing.md,
    gap: spacing.xs,
  },
});

export function ActivityView({
  state,
  workspaceName,
  data,
  error,
  onRetry,
  onSwitchScope,
}: ActivityViewProps): React.JSX.Element {
  const colors = useThemeColors();
  const recordedThrough = recordedThroughLabel(data?.recordedThrough ?? null);
  return (
    <View style={styles.container} testID="activity">
      <AppText variant="title" accessibilityRole="header">
        Activity
      </AppText>
      <AppText variant="body" tone="secondary" testID="activity-workspace">
        {workspaceName}
      </AppText>

      <ScopedStates
        state={state}
        testIDPrefix="activity"
        loadingLabel="Loading activity"
        error={error}
        onRetry={onRetry}
        onSwitchScope={onSwitchScope}
      />

      {state === 'empty' ? (
        <EmptyState
          title="No activity yet"
          body="Once work starts in this workspace, what happens will be listed here."
          testID="activity-empty"
        />
      ) : null}

      {state === 'ready' && data ? (
        <View style={styles.list} testID="activity-list">
          {data.items.map((entry) => (
            <View
              key={entry.id}
              style={[
                styles.entry,
                { backgroundColor: colors.surface, borderColor: colors.divider },
              ]}
              testID={`activity-entry-${entry.id}`}
              accessibilityLabel={`${ACTIVITY_KIND_LABEL[entry.kind]} by ${ACTOR_LABEL[entry.actorRole]} on ${formatServerTimestamp(entry.occurredAt)}`}
            >
              <AppText variant="label">{ACTIVITY_KIND_LABEL[entry.kind]}</AppText>
              <AppText variant="caption" tone="secondary">
                {`${ACTOR_LABEL[entry.actorRole]} · ${formatServerTimestamp(entry.occurredAt)}`}
              </AppText>
            </View>
          ))}
        </View>
      ) : null}

      {state === 'ready' && recordedThrough ? (
        <AppText variant="caption" tone="secondary" testID="activity-recorded-through">
          {recordedThrough}
        </AppText>
      ) : null}
    </View>
  );
}
