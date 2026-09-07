/** One request, read-only.
 *
 * A request id can arrive from a route param or a deep link, and a param
 * is never scope (threat T5). The repository still queries within the
 * selected scope and RLS filters before that, so a request belonging to
 * another workspace simply produces no row — and this screen shows
 * "not found here" rather than anything that would confirm it exists
 * somewhere else.
 *
 * Presentation (HIVE 2026 design, 2026-09-07): the title and status lead,
 * the explanation follows, and a small table of owner and dates keeps
 * responsibility together; the only action is the existing Back. */
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
import { layout, spacing } from '@/ui/tokens';

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
  detail: {
    gap: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: layout.hairline,
  },
  table: {
    gap: spacing.sm,
    paddingTop: spacing.md,
    borderTopWidth: layout.hairline,
  },
  tableRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    gap: spacing.sm,
  },
  tableLabel: { minWidth: 112 },
  tableValue: { flex: 1, minWidth: 120 },
});

function DetailRow({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}): React.JSX.Element {
  // One accessible item per row: a reader hears "Owner: You", not two
  // unrelated fragments.
  return (
    <View style={styles.tableRow} accessible accessibilityLabel={`${label}: ${value}`}>
      <AppText variant="caption" tone="secondary" style={styles.tableLabel}>
        {label}
      </AppText>
      <AppText variant={strong ? 'bodyStrong' : 'caption'} style={styles.tableValue}>
        {value}
      </AppText>
    </View>
  );
}

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
          style={[styles.detail, { borderTopColor: colors.divider }]}
          testID="request-detail-ready"
        >
          <AppText variant="heading">{request.title}</AppText>
          <StatusBadge
            kind={presentation.kind}
            label={presentation.label}
            testID="request-detail-status"
          />
          <AppText variant="body">{request.detail}</AppText>
          <View style={[styles.table, { borderTopColor: colors.divider }]}>
            <DetailRow label="Owner" value={OWNER_LABEL[request.ownerRole]} strong />
            <DetailRow label="Requested" value={formatServerDate(request.requestedOn)} />
            {request.dueOn ? (
              <DetailRow label="Due" value={formatServerDate(request.dueOn)} />
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
