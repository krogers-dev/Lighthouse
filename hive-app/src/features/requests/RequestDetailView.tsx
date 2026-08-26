/** One request, read-only.
 *
 * A request id can arrive from a route param or a deep link, and a param
 * is never scope (threat T5). The repository still queries within the
 * selected scope and RLS filters before that, so a request belonging to
 * another workspace simply produces no row — and this screen shows
 * "not found here" rather than anything that would confirm it exists
 * somewhere else. */
import React from 'react';
import { StyleSheet, View } from 'react-native';

import type { SafeError } from '@/core/errors';
import type { RequestDetail } from '@/data/supabase/repositories';
import {
  OWNER_LABEL,
  REQUEST_STATUS_PRESENTATION,
  formatServerDate,
} from '@/features/shared/labels';
import { ScopedStates } from '@/features/shared/ScopedStates';
import type { ScopedLoadStateName } from '@/features/shared/useScopedLoad';
import { AppText, Button, EmptyState, StatusBadge, useThemeColors } from '@/ui';
import { radii, spacing } from '@/ui/tokens';

export interface RequestDetailViewProps {
  state: ScopedLoadStateName;
  request?: RequestDetail | null;
  error?: SafeError;
  onRetry: () => void;
  onSwitchScope?: () => void;
  onBack: () => void;
}

const styles = StyleSheet.create({
  container: { gap: spacing.lg },
  card: {
    borderRadius: radii.lg,
    borderWidth: 1,
    padding: spacing.md,
    gap: spacing.sm,
  },
  meta: { gap: spacing.xs },
});

export function RequestDetailView({
  state,
  request,
  error,
  onRetry,
  onSwitchScope,
  onBack,
}: RequestDetailViewProps): React.JSX.Element {
  const colors = useThemeColors();
  const presentation = request ? REQUEST_STATUS_PRESENTATION[request.status] : null;
  return (
    <View style={styles.container} testID="request-detail">
      <AppText variant="title" accessibilityRole="header">
        Request
      </AppText>

      <ScopedStates
        state={state}
        testIDPrefix="request-detail"
        loadingLabel="Loading request"
        error={error}
        onRetry={onRetry}
        onSwitchScope={onSwitchScope}
      />

      {/* An id outside this workspace resolves to no row. The wording says
          only that it is not here — never that it exists elsewhere. */}
      {state === 'empty' ? (
        <EmptyState
          title="Request not found here"
          body="This request is not part of the workspace you are viewing."
          testID="request-detail-empty"
        />
      ) : null}

      {state === 'ready' && request && presentation ? (
        <View
          style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.divider }]}
          testID="request-detail-ready"
        >
          <AppText variant="heading">{request.title}</AppText>
          <StatusBadge
            kind={presentation.kind}
            label={presentation.label}
            testID="request-detail-status"
          />
          <AppText variant="body">{request.detail}</AppText>
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
        </View>
      ) : null}

      {/* Milestone 1 is read-only: there is no respond or upload control
          here, absent rather than disabled (rollout control C3). */}
      <Button
        kind="secondary"
        label="Back to requests"
        onPress={onBack}
        testID="request-detail-back"
      />
    </View>
  );
}
