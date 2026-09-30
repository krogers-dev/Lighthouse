/** Activity: a bounded, append-only trail of what has happened in this
 * workspace (WO-002 R3).
 *
 * Each entry is an enumerated event kind, an acting ROLE, and a server
 * date — never a personal name, a filename, or a value. That is enforced
 * by the schema (activity_events has no free-text column), so this screen
 * cannot render something the database was never able to hold.
 *
 * Presentation (HIVE 2026 design, 2026-09-07): a quiet list. A small
 * accent dot supports the sequence; the words carry the meaning. */
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
import { AppText, Button, EmptyState, useThemeColors } from '@/ui';
import { layout, spacing } from '@/ui/tokens';

export interface ActivityViewProps {
  state: ScopedLoadStateName;
  workspaceName: string;
  data?: ScopedList<ActivityEntry>;
  error?: SafeError;
  onRetry: () => void;
  onSwitchScope?: () => void;
}

const DOT = 8;

const styles = StyleSheet.create({
  container: { gap: spacing.lg },
  heading: { gap: spacing.xs },
  list: {
    paddingTop: spacing.md,
    borderTopWidth: layout.hairline,
  },
  entry: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  dot: {
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
    marginTop: spacing.sm,
  },
  entryBody: {
    flex: 1,
    gap: spacing.xs,
    paddingBottom: spacing.md,
    marginBottom: spacing.md,
    borderBottomWidth: layout.hairline,
  },
  footer: { gap: spacing.sm },
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
      <View style={styles.heading}>
        <AppText variant="title" accessibilityRole="header">
          Activity
        </AppText>
        <AppText variant="caption" tone="secondary" testID="activity-workspace">
          {workspaceName}
        </AppText>
      </View>

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
        <View style={[styles.list, { borderTopColor: colors.divider }]} testID="activity-list">
          {data.items.map((entry) => (
            <View
              key={entry.id}
              style={styles.entry}
              testID={`activity-entry-${entry.id}`}
              accessibilityLabel={`${ACTIVITY_KIND_LABEL[entry.kind]} by ${ACTOR_LABEL[entry.actorRole]} on ${formatServerTimestamp(entry.occurredAt)}`}
            >
              <View
                style={[styles.dot, { backgroundColor: colors.accent }]}
                importantForAccessibility="no"
              />
              <View style={[styles.entryBody, { borderBottomColor: colors.divider }]}>
                <AppText variant="subheading">{ACTIVITY_KIND_LABEL[entry.kind]}</AppText>
                <AppText variant="caption" tone="secondary">
                  {`${ACTOR_LABEL[entry.actorRole]} · ${formatServerTimestamp(entry.occurredAt)}`}
                </AppText>
              </View>
            </View>
          ))}
        </View>
      ) : null}

      {/* R7: a reload affordance on the screen itself, not only inside an
          error state. There is no background polling. */}
      {state === 'ready' || state === 'empty' ? (
        <View style={styles.footer}>
          {recordedThrough ? (
            <AppText variant="caption" tone="secondary" testID="activity-recorded-through">
              {recordedThrough}
            </AppText>
          ) : null}
          <Button kind="secondary" label="Refresh" onPress={onRetry} testID="activity-refresh" />
        </View>
      ) : null}
    </View>
  );
}
