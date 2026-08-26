/** Requests list: what Honeybee Accounting is waiting on from this
 * workspace, and what is already answered. Read-only by construction —
 * there is no respond, upload, or edit control anywhere in this binary
 * (WO-002 R2, rollout control C3: absent, not disabled or hidden). */
import React from 'react';
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
import { radii, spacing } from '@/ui/tokens';

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
  list: { gap: spacing.sm },
  card: {
    borderRadius: radii.lg,
    borderWidth: 1,
    padding: spacing.md,
    gap: spacing.sm,
    // 48dp Android / 44pt iOS minimum target, met by padding plus content.
    minHeight: 48,
    justifyContent: 'center',
  },
  meta: { gap: spacing.xs },
  refresh: { gap: spacing.xs },
});

function RequestCard({
  request,
  onPress,
}: {
  request: RequestSummary;
  onPress: () => void;
}): React.JSX.Element {
  const colors = useThemeColors();
  const presentation = REQUEST_STATUS_PRESENTATION[request.status];
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${request.title}. ${presentation.label}. Owner: ${OWNER_LABEL[request.ownerRole]}.`}
      accessibilityHint="Opens the request details"
      testID={`request-card-${request.id}`}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: colors.surface,
          borderColor: colors.divider,
          // Matches the Button primitive's press feedback (no layout animation).
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
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
          <AppText variant="caption" tone="secondary">
            {`Due ${formatServerDate(request.dueOn)}`}
          </AppText>
        ) : null}
      </View>
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
  const recordedThrough = recordedThroughLabel(data?.recordedThrough ?? null);
  return (
    <View style={styles.container} testID="requests">
      <AppText variant="title" accessibilityRole="header">
        Requests
      </AppText>
      <AppText variant="body" tone="secondary" testID="requests-workspace">
        {workspaceName}
      </AppText>

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
            <RequestCard
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
        <View style={styles.refresh}>
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
