/** One request, with its documents (WO-003).
 *
 * A request id can arrive from a route param or a deep link, and a param
 * is never scope (threat T5). The repository still queries within the
 * selected scope and RLS filters before that, so a request belonging to
 * another workspace simply produces no row, and this screen shows
 * "not found here" rather than anything that would confirm it exists
 * somewhere else.
 *
 * Presentation (HIVE 2026 design, 2026-09-07): the title and status lead,
 * the explanation follows, and a small table of owner and dates keeps
 * responsibility together. Milestone 2 adds the documents on the request
 * as rows on thin rules, each with its true status, and ONE primary
 * action, "Add a document", present only when the server-confirmed role
 * is a client user, the request is open, and the request has room. For
 * staff, for a closed request, and at the cap the control is absent, not
 * disabled (rollout control C3). */
import React from 'react';
import { StyleSheet, View } from 'react-native';

import type { SafeError } from '@/core/errors';
import type { DocumentSummary } from '@/data/supabase/documents';
import type { RequestDetail, ScopedList } from '@/data/supabase/repositories';
import { formatByteSize } from '@/features/documents/document-rules';
import {
  DOCUMENT_STATUS_PRESENTATION,
  OWNER_LABEL,
  REQUEST_STATUS_PRESENTATION,
  formatServerDate,
  formatServerTimestamp,
} from '@/features/shared/labels';
import { ScopedStates } from '@/features/shared/ScopedStates';
import type { ScopedLoadStateName } from '@/features/shared/useScopedLoad';
import { AppText, Button, EmptyState, StatusBadge, useThemeColors } from '@/ui';
import { layout, spacing } from '@/ui/tokens';

export interface RequestDetailViewProps {
  state: ScopedLoadStateName;
  request?: RequestDetail | null;
  /** The documents on the request, loaded with it. Absent while loading. */
  documents?: ScopedList<DocumentSummary>;
  /** Whether the ONE write control exists on this screen. Decided by the
   * screen from the server-confirmed role, the request status, and the
   * cap; never from anything the route or a param says. */
  canAddDocument?: boolean;
  error?: SafeError;
  onRetry: () => void;
  onSwitchScope?: () => void;
  onAddDocument?: () => void;
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
  documents: {
    gap: spacing.sm,
    paddingTop: spacing.md,
    borderTopWidth: layout.hairline,
  },
  documentRow: {
    gap: spacing.xs,
    paddingVertical: spacing.md,
    borderTopWidth: layout.hairline,
  },
  actions: { gap: spacing.md },
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

/** When the document was last touched by the workflow, in client words. */
function documentDateLine(document: DocumentSummary): string | null {
  if (document.checkedAt && (document.status === 'ACCEPTED' || document.status === 'REJECTED')) {
    return `Checked ${formatServerTimestamp(document.checkedAt)}`;
  }
  if (document.receivedAt) return `Received ${formatServerTimestamp(document.receivedAt)}`;
  return null;
}

function DocumentRow({ document }: { document: DocumentSummary }): React.JSX.Element {
  const colors = useThemeColors();
  const presentation = DOCUMENT_STATUS_PRESENTATION[document.status];
  const dateLine = documentDateLine(document);
  // Not pressable: there is nothing to open (a quarantined object is never
  // readable back), so the content stays individually reachable.
  return (
    <View
      style={[styles.documentRow, { borderTopColor: colors.divider }]}
      testID={`request-document-${document.id}`}
    >
      <AppText variant="bodyStrong">{document.displayName}</AppText>
      <StatusBadge kind={presentation.kind} label={presentation.label} />
      <AppText variant="caption" tone="secondary">
        {dateLine
          ? `${formatByteSize(document.byteSize)} · ${dateLine}`
          : formatByteSize(document.byteSize)}
      </AppText>
    </View>
  );
}

export function RequestDetailView({
  state,
  request,
  documents,
  canAddDocument = false,
  error,
  onRetry,
  onSwitchScope,
  onAddDocument,
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
          only that it is not here, never that it exists elsewhere. */}
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

          <View
            style={[styles.documents, { borderTopColor: colors.divider }]}
            testID="request-detail-documents"
          >
            <AppText variant="subheading" accessibilityRole="header">
              Documents
            </AppText>
            {documents && documents.items.length > 0 ? (
              documents.items.map((document) => (
                <DocumentRow key={document.id} document={document} />
              ))
            ) : (
              <AppText variant="body" tone="secondary" testID="request-detail-documents-empty">
                No documents on this request yet.
              </AppText>
            )}
          </View>

          {/* The one write control this milestone adds, and only when the
              server-confirmed role, the request status, and the cap all
              allow it (WO-003). Absent otherwise, never disabled. */}
          {canAddDocument && onAddDocument ? (
            <Button
              label="Add a document"
              onPress={onAddDocument}
              accessibilityHint="Opens the screen to choose and send a document for this request"
              testID="request-detail-add-document"
            />
          ) : null}
        </View>
      ) : null}

      <View style={styles.actions}>
        <Button
          kind="secondary"
          label="Back to requests"
          onPress={onBack}
          testID="request-detail-back"
        />
      </View>
    </View>
  );
}
