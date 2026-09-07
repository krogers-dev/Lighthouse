/** Requests list: what Honeybee Accounting is waiting on from this
 * workspace, and what is already answered. Read-only by construction —
 * there is no respond, upload, or edit control anywhere in this binary
 * (WO-002 R2, rollout control C3: absent, not disabled or hidden).
 *
 * Presentation (HIVE 2026 design, 2026-09-07): tappable rows separated by
 * thin rules, each with the title, the exact status, owner, requested and
 * due dates, and a chevron that says the row opens. */
import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import type { SafeError } from '@/core/errors';
import type { RequestSummary, ScopedList } from '@/data/supabase/repositories';
import {
  OWNER_LABEL,
  REQUEST_STATUS_PRESENTATION,
  formatServerDate,
  recordedThroughLabel,
} from '@/features/shared/labels';
import { ScopedStates } from '@/features/shared/ScopedStates';
import type { ScopedLoadStateName } from '@/features/shared/useScopedLoad';
import { AppText, Button, EmptyState, StatusBadge, useThemeColors } from '@/ui';
import { layout, spacing, touchTarget } from '@/ui/tokens';

export interface RequestsViewProps {
  state: ScopedLoadStateName;
  workspaceName: string;
  data?: ScopedList<RequestSummary>;
  error?: SafeError;
  onRetry: () => void;
  onSwitchScope?: () => void;
  onOpenRequest: (requestId: string) => void;
}

const styles = StyleSheet.create({
  container: { gap: spacing.lg },
  heading: { gap: spacing.xs },
  list: {},
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderTopWidth: layout.hairline,
    // 48 minimum target, met by padding plus content.
    minHeight: touchTarget.minHeight,
  },
  rowBody: { flex: 1, gap: spacing.sm },
  chevron: { paddingTop: spacing.xs },
  meta: { gap: spacing.xs },
  footer: {
    gap: spacing.sm,
    paddingTop: spacing.md,
    borderTopWidth: layout.hairline,
  },
  focused: {
    outlineStyle: 'solid',
    outlineWidth: layout.focusRingWidth,
    outlineOffset: layout.focusRingOffset,
  },
});

function RequestRow({
  request,
  onPress,
}: {
  request: RequestSummary;
  onPress: () => void;
}): React.JSX.Element {
  const colors = useThemeColors();
  const [focused, setFocused] = useState(false);
  const presentation = REQUEST_STATUS_PRESENTATION[request.status];
  return (
    <Pressable
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      accessibilityRole="button"
      accessibilityLabel={`${request.title}. ${presentation.label}. Owner: ${OWNER_LABEL[request.ownerRole]}.`}
      accessibilityHint="Opens the request details"
      testID={`request-card-${request.id}`}
      style={({ pressed }) => [
        styles.row,
        {
          borderTopColor: colors.divider,
          // Matches the Button primitive's press feedback (no layout animation).
          opacity: pressed ? 0.85 : 1,
        },
        focused && [styles.focused, { outlineColor: colors.focusRing }],
      ]}
    >
      <View style={styles.rowBody}>
        <AppText variant="heading">{request.title}</AppText>
        <StatusBadge kind={presentation.kind} label={presentation.label} />
        <View style={styles.meta}>
          <AppText variant="caption" tone="secondary">
            {`Owner: ${OWNER_LABEL[request.ownerRole]}`}
          </AppText>
          <AppText variant="caption" tone="secondary">
            {`Requested ${formatServerDate(request.requestedOn)}`}
          </AppText>
          {request.dueOn ? (
            <AppText variant="captionStrong">{`Due ${formatServerDate(request.dueOn)}`}</AppText>
          ) : null}
        </View>
      </View>
      <AppText
        variant="heading"
        tone="secondary"
        style={styles.chevron}
        importantForAccessibility="no"
      >
        ›
      </AppText>
    </Pressable>
  );
}

export function RequestsView({
  state,
  workspaceName,
  data,
  error,
  onRetry,
  onSwitchScope,
  onOpenRequest,
}: RequestsViewProps): React.JSX.Element {
  const colors = useThemeColors();
  const recordedThrough = recordedThroughLabel(data?.recordedThrough ?? null);
  return (
    <View style={styles.container} testID="requests">
      <View style={styles.heading}>
        <AppText variant="title" accessibilityRole="header">
          Requests
        </AppText>
        <AppText variant="caption" tone="secondary" testID="requests-workspace">
          {workspaceName}
        </AppText>
      </View>

      <ScopedStates
        state={state}
        testIDPrefix="requests"
        loadingLabel="Loading requests"
        error={error}
        onRetry={onRetry}
        onSwitchScope={onSwitchScope}
      />

      {state === 'empty' ? (
        <EmptyState
          title="No open requests"
          body="Nothing is being asked of this workspace right now."
          testID="requests-empty"
        />
      ) : null}

      {state === 'ready' && data ? (
        <View style={styles.list} testID="requests-list">
          {data.items.map((request) => (
            <RequestRow
              key={request.id}
              request={request}
              onPress={() => onOpenRequest(request.id)}
            />
          ))}
        </View>
      ) : null}

      {/* R7: a reload affordance on the screen itself, not only inside an
          error state. There is no background polling. */}
      {state === 'ready' || state === 'empty' ? (
        <View style={[styles.footer, { borderTopColor: colors.divider }]}>
          {recordedThrough ? (
            <AppText variant="caption" tone="secondary" testID="requests-recorded-through">
              {recordedThrough}
            </AppText>
          ) : null}
          <Button kind="secondary" label="Refresh" onPress={onRetry} testID="requests-refresh" />
        </View>
      ) : null}
    </View>
  );
}
