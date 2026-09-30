/** One request, with its documents (WO-003) and its answer (WO-004).
 *
 * A request id can arrive from a route param or a deep link, and a param
 * is never scope (threat T5). The repository still queries within the
 * selected scope and RLS filters before that, so a request belonging to
 * another workspace simply produces no row, and this screen shows
 * "not found here" rather than anything that would confirm it exists
 * somewhere else.
 *
 * Presentation (HIVE 2026 design, 2026-09-07): the title and status lead,
 * the explanation follows, and a small table of owner, dates, and (when
 * the request is about one) the source document keeps responsibility
 * together. Milestone 2 adds the documents on the request as rows on
 * thin rules, each with its true status. Milestone 3 adds the answer:
 * a submitted one is shown to everyone who may read it, a draft is named
 * to its writer, and the ONE primary action for a client user on an open
 * request is to answer it; adding a document stands beside it as the
 * secondary control. For staff, for a closed request, and once an answer
 * is submitted the controls are absent, not disabled (rollout control
 * C3). */
import React from 'react';
import { StyleSheet, View } from 'react-native';

import type { SafeError } from '@/core/errors';
import type { RequestAnswer } from '@/data/supabase/answers';
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
import type { MembershipRole } from '@/tenancy/types';
import { AppText, Button, EmptyState, StatusBadge, useThemeColors } from '@/ui';
import { layout, radii, spacing } from '@/ui/tokens';

export interface RequestDetailViewProps {
  state: ScopedLoadStateName;
  request?: RequestDetail | null;
  /** The documents on the request, loaded with it. Absent while loading. */
  documents?: ScopedList<DocumentSummary>;
  /** The answer on the request: a client's own draft, or a submitted
   * answer, or none. Staff only ever receive a submitted one (RLS). */
  answer?: RequestAnswer | null;
  /** The document the request is about, resolved inside the scope. */
  subjectDocument?: DocumentSummary | null;
  /** The server-confirmed role of the viewer, for whose answer it is. */
  viewerRole?: MembershipRole | null;
  /** Whether the document write control exists on this screen. Decided
   * by the screen from the server-confirmed role, the request status,
   * and the cap; never from anything the route or a param says. */
  canAddDocument?: boolean;
  /** Whether the answer control exists: a client user, an open request,
   * and no submitted answer. */
  canAnswer?: boolean;
  error?: SafeError;
  onRetry: () => void;
  onSwitchScope?: () => void;
  onAddDocument?: () => void;
  onAnswer?: () => void;
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
  answer: {
    gap: spacing.sm,
    paddingTop: spacing.md,
    borderTopWidth: layout.hairline,
  },
  answerPanel: {
    borderRadius: radii.lg,
    padding: spacing.md,
    gap: spacing.xs,
  },
  actions: { gap: spacing.md },
});

function DetailRow({
  label,
  value,
  strong = false,
  testID,
}: {
  label: string;
  value: string;
  strong?: boolean;
  testID?: string;
}): React.JSX.Element {
  // One accessible item per row: a reader hears "Owner: You", not two
  // unrelated fragments.
  return (
    <View
      style={styles.tableRow}
      accessible
      accessibilityLabel={`${label}: ${value}`}
      testID={testID}
    >
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

/** The names of the documents an answer refers to, resolved from the
 * request's own documents (a citation is always one of them). */
function citedNames(
  answer: RequestAnswer,
  documents: ScopedList<DocumentSummary> | undefined,
): string[] {
  return answer.citedDocumentIds
    .map((id) => documents?.items.find((document) => document.id === id)?.displayName ?? null)
    .filter((name): name is string => name !== null);
}

function AnswerSection({
  request,
  answer,
  documents,
  viewerRole,
  canAnswer,
  onAnswer,
}: {
  request: RequestDetail;
  answer: RequestAnswer | null;
  documents: ScopedList<DocumentSummary> | undefined;
  viewerRole: MembershipRole | null;
  canAnswer: boolean;
  onAnswer?: () => void;
}): React.JSX.Element {
  const colors = useThemeColors();
  const names = answer ? citedNames(answer, documents) : [];
  const whose = viewerRole === 'client_user' ? 'Your answer' : "The client's answer";
  const submittedLine = answer?.submittedAt
    ? ` · Submitted ${formatServerTimestamp(answer.submittedAt)}`
    : '';
  return (
    <View
      style={[styles.answer, { borderTopColor: colors.divider }]}
      testID="request-detail-answer-section"
    >
      <AppText variant="subheading" accessibilityRole="header">
        Answer
      </AppText>
      {answer && answer.status === 'SUBMITTED' ? (
        <View
          style={[styles.answerPanel, { backgroundColor: colors.panelStableBackground }]}
          testID="request-detail-answer-submitted"
        >
          <AppText variant="caption" style={{ color: colors.panelStableText }}>
            {`${whose}${submittedLine}`}
          </AppText>
          <AppText
            variant="body"
            style={{ color: colors.panelStableText }}
            testID="request-detail-answer-body"
          >
            {answer.body}
          </AppText>
          {names.length > 0 ? (
            <AppText variant="caption" style={{ color: colors.panelStableText }}>
              {`Refers to: ${names.join(', ')}`}
            </AppText>
          ) : null}
        </View>
      ) : null}
      {answer && answer.status === 'DRAFT' ? (
        <AppText variant="body" tone="secondary" testID="request-detail-answer-draft">
          {`Draft saved ${formatServerTimestamp(answer.updatedAt)}. Not submitted yet.`}
        </AppText>
      ) : null}
      {!answer ? (
        <AppText variant="body" tone="secondary" testID="request-detail-answer-none">
          {request.status === 'OPEN' ? 'No answer yet.' : 'No answer is recorded in HIVE.'}
        </AppText>
      ) : null}
      {/* The primary action of an open request for the person it is
          asked of (WO-004). Absent otherwise, never disabled. */}
      {canAnswer && onAnswer ? (
        <Button
          label={answer ? 'Continue your answer' : 'Answer this request'}
          onPress={onAnswer}
          accessibilityHint="Opens the screen to write and submit your answer"
          testID="request-detail-answer"
        />
      ) : null}
    </View>
  );
}

export function RequestDetailView({
  state,
  request,
  documents,
  answer = null,
  subjectDocument = null,
  viewerRole = null,
  canAddDocument = false,
  canAnswer = false,
  error,
  onRetry,
  onSwitchScope,
  onAddDocument,
  onAnswer,
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
            {/* The document the request is about (WO-004): named only when
                the scoped read resolved it; a link the read could not
                resolve shows nothing at all. */}
            {subjectDocument ? (
              <DetailRow
                label="About"
                value={subjectDocument.displayName}
                testID="request-detail-subject"
              />
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

          <AnswerSection
            request={request}
            answer={answer}
            documents={documents}
            viewerRole={viewerRole}
            canAnswer={canAnswer}
            onAnswer={onAnswer}
          />

          {/* The document write control (WO-003), only when the
              server-confirmed role, the request status, and the cap all
              allow it. Secondary beside the answer control, primary when
              it stands alone; absent otherwise, never disabled. */}
          {canAddDocument && onAddDocument ? (
            <Button
              kind={canAnswer ? 'secondary' : 'primary'}
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
