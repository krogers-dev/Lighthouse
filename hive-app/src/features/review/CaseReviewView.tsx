/** The case review for staff (WO-005, WO-006).
 *
 * What a reviewer or approver reads before acting: the case and its
 * status, the frozen package (which requests, answers, and documents it
 * holds, and the digest that names it exactly), the verdicts recorded on
 * it, the approvals bound to it, the ledger objects the case refers to
 * (identifiers, versions, and digests, never values), and the filing
 * receipts that say which approved documents were filed to the
 * permanent record by hand and whether the record was found to hold
 * those bytes. Then the ONE action the viewer's role may take now,
 * through an explicit confirmation that says what the action means.
 * Review is read-only: nothing here edits evidence. An approval names
 * the package id and digest the screen shows and the HIVE record as its
 * only destination. A filing receipt names one checked document and the
 * Drive object the person filed it at; HIVE writes nothing to Drive. A
 * refusal says why and what to do; a stale screen is sent to reload,
 * never to act on old state.
 *
 * A client user reaching this route sees only that the page is for staff
 * and the way back; the server refuses them every row regardless. */
import React from 'react';
import { StyleSheet, View } from 'react-native';

import type { SafeError } from '@/core/errors';
import { formatCount } from '@/core/text';
import type { DocumentSummary } from '@/data/supabase/documents';
import type { RequestSummary } from '@/data/supabase/repositories';
import type {
  CaseApproval,
  CaseRecord,
  CaseReview,
  FilingReceipt,
  LedgerReference,
  ReviewPackage,
  ReviewVerdict,
} from '@/data/supabase/reviews';
import { formatByteSize } from '@/features/documents/document-rules';
import {
  APPROVAL_END_REASON_LABEL,
  APPROVAL_STATUS_PRESENTATION,
  CASE_ACTION_CONFIRMATION,
  CASE_ACTION_DONE,
  CASE_STATUS_PRESENTATION,
  DESTINATION_LABEL,
  FILING_STATUS_PRESENTATION,
  LEDGER_OBJECT_TYPE_LABEL,
  OWNER_LABEL,
  REQUEST_STATUS_PRESENTATION,
  REVIEW_REFUSAL_WORDING,
  REVIEW_ROLE_LABEL,
  VERDICT_PRESENTATION,
  caseActionLabel,
  formatServerTimestamp,
} from '@/features/shared/labels';
import { ScopedStates } from '@/features/shared/ScopedStates';
import type { ScopedLoadStateName } from '@/features/shared/useScopedLoad';
import { type MembershipRole, isStaffRole } from '@/tenancy/types';
import {
  AppText,
  Button,
  EmptyState,
  LoadingState,
  Notice,
  StatusBadge,
  TextField,
  useThemeColors,
} from '@/ui';
import { layout, radii, spacing } from '@/ui/tokens';

import { type ReviewFlowState, canAct, isBusy, isStaleRefusal } from './review-flow';
import {
  type CaseAction,
  FILING_LIMITS,
  NOTE_LIMITS,
  filableDocuments,
  isNavigationAction,
  noteLength,
  requestActionsFor,
} from './review-rules';

export interface CaseReviewViewProps {
  state: ScopedLoadStateName;
  caseRecord?: CaseRecord | null;
  package?: ReviewPackage | null;
  reviews: readonly CaseReview[];
  approvals: readonly CaseApproval[];
  /** The scope's requests, to name the ones the package froze. */
  requests: readonly RequestSummary[];
  /** The case's documents, to name the ones a receipt may file or filed. */
  documents: readonly DocumentSummary[];
  /** Read-only pointers into the ledger (WO-006). Never values. */
  references: readonly LedgerReference[];
  /** What was filed to the permanent record by hand, and whether it held. */
  receipts: readonly FilingReceipt[];
  role: MembershipRole | null;
  /** The actions the viewer's role may take on the case now. */
  actions: readonly CaseAction[];
  /** The verdicts the viewer's role may record. */
  verdicts: readonly ReviewVerdict[];
  flow: ReviewFlowState;
  error?: SafeError;
  onRetry: () => void;
  onSwitchScope?: () => void;
  onBack: () => void;
  onChooseVerdict: (verdict: ReviewVerdict) => void;
  onChangeNote: (note: string) => void;
  onChooseFilingDocument: (documentId: string) => void;
  onChangeFileId: (driveFileId: string) => void;
  onChangePath: (drivePath: string) => void;
  onRequestAction: (action: CaseAction) => void;
  /** Intake (WO-013): names the request to close and asks to confirm. */
  onCloseRequest: (requestId: string, requestVersion: number) => void;
  /** Intake (WO-013): opens the screen that asks the client for something. */
  onAddRequest?: () => void;
  onConfirm: () => void;
  onCancel: () => void;
  onDismiss: () => void;
  onTryAgain: () => void;
}

/** Literal test ids, so the flow validator can see them (a template would
 * be invisible to it). */
const CASE_ACTION_TEST_IDS = {
  freeze: 'case-review-action-freeze',
  start_review: 'case-review-action-start-review',
  record_verdict: 'case-review-action-record-verdict',
  approve: 'case-review-action-approve',
  resume: 'case-review-action-resume',
  record_filing: 'case-review-action-record-filing',
  record_intake: 'case-review-action-record-intake',
  discard_draft: 'case-review-action-discard-draft',
  add_request: 'case-review-action-add-request',
  close_request: 'case-review-action-close-request',
} as const;

const VERDICT_TEST_IDS = {
  PASS: 'case-review-verdict-pass',
  RETURN: 'case-review-verdict-return',
  HOLD: 'case-review-verdict-hold',
} as const;

const RUNNING_LABEL: Record<CaseAction, string> = {
  freeze: 'Freezing the package',
  start_review: 'Starting the review',
  record_verdict: 'Recording the verdict',
  approve: 'Recording the approval',
  resume: 'Resuming the case',
  record_filing: 'Recording the filing receipt',
  record_intake: 'Recording the intake',
  discard_draft: 'Discarding the draft',
  add_request: 'Opening the request',
  close_request: 'Closing the request',
};

const styles = StyleSheet.create({
  container: { gap: spacing.lg },
  heading: { gap: spacing.sm },
  section: {
    gap: spacing.sm,
    paddingTop: spacing.md,
    borderTopWidth: layout.hairline,
  },
  row: {
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    borderTopWidth: layout.hairline,
  },
  panel: {
    borderRadius: radii.lg,
    padding: spacing.md,
    gap: spacing.xs,
  },
  actions: { gap: spacing.md },
  verdicts: { gap: spacing.sm },
  filing: { gap: spacing.sm },
});

/** The case's own requests, for intake and the preparer: what has been
 * asked of the client, and the close of one that is open or answered
 * (WO-013). Read-only for everyone else. */
function RequestsSection({
  requests,
  role,
  offersClose,
  onCloseRequest,
}: {
  requests: readonly RequestSummary[];
  role: MembershipRole | null;
  offersClose: boolean;
  onCloseRequest: (requestId: string, requestVersion: number) => void;
}): React.JSX.Element {
  const colors = useThemeColors();
  return (
    <View
      style={[styles.section, { borderTopColor: colors.divider }]}
      testID="case-review-requests"
    >
      <AppText variant="subheading" accessibilityRole="header">
        Requests to the client
      </AppText>
      {requests.length === 0 ? (
        <AppText variant="body" tone="secondary" testID="case-review-no-requests">
          Nothing has been asked of the client on this case yet.
        </AppText>
      ) : (
        requests.map((request) => {
          const presentation = REQUEST_STATUS_PRESENTATION[request.status];
          const closable =
            offersClose && requestActionsFor(role, request.status).includes('close_request');
          return (
            <View
              key={request.id}
              style={[styles.row, { borderTopColor: colors.divider }]}
              testID={`case-review-request-${request.id}`}
            >
              <AppText variant="bodyStrong">{request.title}</AppText>
              <StatusBadge kind={presentation.kind} label={presentation.label} />
              <AppText variant="caption" tone="secondary">
                {request.dueOn
                  ? `Requested ${request.requestedOn} · due ${request.dueOn}`
                  : `Requested ${request.requestedOn} · no due date`}
              </AppText>
              {closable ? (
                <Button
                  kind="secondary"
                  label="Close request"
                  onPress={() => onCloseRequest(request.id, request.version)}
                  accessibilityHint="Asks you to confirm before the request is closed"
                  testID={`case-review-close-request-${request.id}`}
                />
              ) : null}
            </View>
          );
        })
      )}
    </View>
  );
}

function shortDigest(digest: string): string {
  return digest.length > 16 ? `${digest.slice(0, 16)}…` : digest;
}

function documentName(documents: readonly DocumentSummary[], documentId: string): string {
  return documents.find((document) => document.id === documentId)?.displayName ?? 'Document';
}

function PackageSection({
  current,
  requests,
}: {
  current: ReviewPackage | null;
  requests: readonly RequestSummary[];
}): React.JSX.Element {
  const colors = useThemeColors();
  if (!current) {
    return (
      <View style={[styles.section, { borderTopColor: colors.divider }]}>
        <AppText variant="subheading" accessibilityRole="header">
          Review package
        </AppText>
        <AppText variant="body" tone="secondary" testID="case-review-no-package">
          No package has been frozen yet.
        </AppText>
      </View>
    );
  }
  const byId = new Map(requests.map((request) => [request.id, request]));
  return (
    <View style={[styles.section, { borderTopColor: colors.divider }]} testID="case-review-package">
      <AppText variant="subheading" accessibilityRole="header">
        {`Review package ${current.packageNumber}`}
      </AppText>
      <AppText variant="caption" tone="secondary">
        {`Frozen ${formatServerTimestamp(current.frozenAt)} by ${OWNER_LABEL[current.frozenRole]} at case version ${current.caseVersion}`}
      </AppText>
      <AppText
        variant="caption"
        tone="secondary"
        accessibilityLabel={`Package digest ${current.manifestDigest}`}
        testID="case-review-package-digest"
      >
        {`Digest ${current.manifestDigest}`}
      </AppText>
      <AppText variant="labelSmall">{`Requests (${current.manifest.requests.length})`}</AppText>
      {current.manifest.requests.map((request) => {
        const known = byId.get(request.id);
        const presentation = known ? REQUEST_STATUS_PRESENTATION[known.status] : null;
        return (
          <View
            key={request.id}
            style={[styles.row, { borderTopColor: colors.divider }]}
            testID={`case-review-request-${request.id}`}
          >
            <AppText variant="bodyStrong">{known ? known.title : `Request ${request.id}`}</AppText>
            <AppText variant="caption" tone="secondary">
              {presentation
                ? `${presentation.label} · frozen at version ${request.version}`
                : `Frozen at version ${request.version}`}
            </AppText>
          </View>
        );
      })}
      <AppText variant="labelSmall">
        {`Submitted answers (${current.manifest.answers.length})`}
      </AppText>
      {current.manifest.answers.length === 0 ? (
        <AppText variant="caption" tone="secondary">
          None in this package.
        </AppText>
      ) : (
        current.manifest.answers.map((answer) => (
          <AppText key={answer.id} variant="caption" tone="secondary">
            {`Answer at version ${answer.version}, text digest ${shortDigest(answer.bodySha256)}`}
          </AppText>
        ))
      )}
      <AppText variant="labelSmall">
        {`Checked documents (${current.manifest.documents.length})`}
      </AppText>
      {current.manifest.documents.length === 0 ? (
        <AppText variant="caption" tone="secondary">
          None in this package.
        </AppText>
      ) : (
        current.manifest.documents.map((document) => (
          <AppText key={document.id} variant="caption" tone="secondary">
            {`${formatByteSize(document.byteSize)}, digest ${shortDigest(document.clientDigest)}`}
          </AppText>
        ))
      )}
    </View>
  );
}

function ReviewsSection({ reviews }: { reviews: readonly CaseReview[] }): React.JSX.Element {
  const colors = useThemeColors();
  return (
    <View
      style={[styles.section, { borderTopColor: colors.divider }]}
      testID="case-review-verdicts"
    >
      <AppText variant="subheading" accessibilityRole="header">
        Verdicts
      </AppText>
      {reviews.length === 0 ? (
        <AppText variant="body" tone="secondary" testID="case-review-no-verdict">
          No verdict on this package yet.
        </AppText>
      ) : (
        reviews.map((review) => {
          const presentation = review.verdict ? VERDICT_PRESENTATION[review.verdict] : null;
          return (
            <View
              key={review.id}
              style={[styles.row, { borderTopColor: colors.divider }]}
              testID={`case-review-verdict-${review.id}`}
            >
              <AppText variant="bodyStrong">{REVIEW_ROLE_LABEL[review.reviewerRole]}</AppText>
              {presentation ? (
                <StatusBadge kind={presentation.kind} label={presentation.label} />
              ) : (
                <StatusBadge kind="neutral" label="In progress" />
              )}
              <AppText variant="caption" tone="secondary">
                {review.recordedAt
                  ? `Recorded ${formatServerTimestamp(review.recordedAt)}`
                  : `Started ${formatServerTimestamp(review.startedAt)}`}
              </AppText>
              {review.note ? <AppText variant="body">{review.note}</AppText> : null}
            </View>
          );
        })
      )}
    </View>
  );
}

function ApprovalsSection({
  approvals,
}: {
  approvals: readonly CaseApproval[];
}): React.JSX.Element {
  const colors = useThemeColors();
  return (
    <View
      style={[styles.section, { borderTopColor: colors.divider }]}
      testID="case-review-approvals"
    >
      <AppText variant="subheading" accessibilityRole="header">
        Approvals
      </AppText>
      {approvals.length === 0 ? (
        <AppText variant="body" tone="secondary" testID="case-review-no-approval">
          No approval on this package.
        </AppText>
      ) : (
        approvals.map((approval) => {
          const presentation = APPROVAL_STATUS_PRESENTATION[approval.status];
          return (
            <View
              key={approval.id}
              style={[styles.row, { borderTopColor: colors.divider }]}
              testID={`case-review-approval-${approval.id}`}
            >
              <StatusBadge kind={presentation.kind} label={presentation.label} />
              <AppText variant="caption" tone="secondary">
                {`Approved ${formatServerTimestamp(approval.approvedAt)} for package ${approval.packageNumber}, digest ${shortDigest(approval.packageDigest)}`}
              </AppText>
              <AppText variant="caption" tone="secondary">
                {`Destination: ${DESTINATION_LABEL[approval.destination] ?? approval.destination}. Expires ${formatServerTimestamp(approval.expiresAt)}.`}
              </AppText>
              {approval.endReason ? (
                <AppText variant="caption" tone="secondary">
                  {APPROVAL_END_REASON_LABEL[approval.endReason] ?? 'Ended.'}
                </AppText>
              ) : null}
            </View>
          );
        })
      )}
    </View>
  );
}

/** The ledger objects the case refers to, as the read-only adapter saw
 * them: what and which version, never what they say. */
function SourcesSection({
  references,
}: {
  references: readonly LedgerReference[];
}): React.JSX.Element {
  const colors = useThemeColors();
  return (
    <View style={[styles.section, { borderTopColor: colors.divider }]} testID="case-review-sources">
      <AppText variant="subheading" accessibilityRole="header">
        Sources
      </AppText>
      <AppText variant="caption" tone="secondary">
        Read-only references into the ledger. HIVE holds what was referred to and when, never its
        contents.
      </AppText>
      {references.length === 0 ? (
        <AppText variant="body" tone="secondary" testID="case-review-no-source">
          No ledger object is referenced by this case.
        </AppText>
      ) : (
        references.map((reference) => (
          <View
            key={reference.id}
            style={[styles.row, { borderTopColor: colors.divider }]}
            testID={`case-review-source-${reference.id}`}
          >
            <AppText variant="bodyStrong">{reference.displayName}</AppText>
            <AppText variant="caption" tone="secondary">
              {`${LEDGER_OBJECT_TYPE_LABEL[reference.objectType] ?? reference.objectType} · version ${reference.objectVersion} · as of ${formatServerTimestamp(reference.asOf)}`}
            </AppText>
            <AppText variant="caption" tone="secondary">
              {`Digest ${shortDigest(reference.objectDigest)} · read by ${reference.adapterName}`}
            </AppText>
          </View>
        ))
      )}
    </View>
  );
}

/** What was filed to the permanent record by hand, and whether the
 * record was found to hold exactly those bytes. */
function RecordSection({
  receipts,
  documents,
}: {
  receipts: readonly FilingReceipt[];
  documents: readonly DocumentSummary[];
}): React.JSX.Element {
  const colors = useThemeColors();
  return (
    <View style={[styles.section, { borderTopColor: colors.divider }]} testID="case-review-record">
      <AppText variant="subheading" accessibilityRole="header">
        Permanent record
      </AppText>
      <AppText variant="caption" tone="secondary">
        Filings to Drive are made by hand and recorded here. HIVE never writes to Drive.
      </AppText>
      {receipts.length === 0 ? (
        <AppText variant="body" tone="secondary" testID="case-review-no-receipt">
          Nothing from this case has been recorded as filed.
        </AppText>
      ) : (
        receipts.map((receipt) => {
          const presentation = FILING_STATUS_PRESENTATION[receipt.status];
          return (
            <View
              key={receipt.id}
              style={[styles.row, { borderTopColor: colors.divider }]}
              testID={`case-review-receipt-${receipt.id}`}
            >
              <AppText variant="bodyStrong">{documentName(documents, receipt.documentId)}</AppText>
              <StatusBadge kind={presentation.kind} label={presentation.label} />
              <AppText variant="caption" tone="secondary">
                {`${receipt.drivePath} · file ${receipt.driveFileId}`}
              </AppText>
              <AppText variant="caption" tone="secondary">
                {`Filed ${formatServerTimestamp(receipt.filedAt)} by ${OWNER_LABEL[receipt.filedRole]} · claimed digest ${shortDigest(receipt.claimedDigest)}`}
              </AppText>
              {receipt.verifiedAt ? (
                <AppText variant="caption" tone="secondary">
                  {`Checked ${formatServerTimestamp(receipt.verifiedAt)} by ${receipt.adapterName ?? 'the record adapter'}${
                    receipt.foundDigest && receipt.status === 'MISMATCH'
                      ? `, found ${shortDigest(receipt.foundDigest)}`
                      : ''
                  }`}
                </AppText>
              ) : null}
            </View>
          );
        })
      )}
    </View>
  );
}

export function CaseReviewView({
  state,
  caseRecord,
  package: current = null,
  reviews,
  approvals,
  requests,
  documents,
  references,
  receipts,
  role,
  actions,
  verdicts,
  flow,
  error,
  onRetry,
  onSwitchScope,
  onBack,
  onChooseVerdict,
  onChangeNote,
  onChooseFilingDocument,
  onChangeFileId,
  onChangePath,
  onRequestAction,
  onCloseRequest,
  onAddRequest,
  onConfirm,
  onCancel,
  onDismiss,
  onTryAgain,
}: CaseReviewViewProps): React.JSX.Element {
  const colors = useThemeColors();
  const staff = role !== null && isStaffRole(role);
  const presentation = caseRecord ? CASE_STATUS_PRESENTATION[caseRecord.status] : null;
  const busy = isBusy(flow);
  const primary = actions[0] ?? null;
  const showsVerdictForm = actions.includes('record_verdict') && canAct(flow);
  const showsFilingForm = actions.includes('record_filing') && canAct(flow);
  const filable = showsFilingForm ? filableDocuments(documents) : [];
  const filing = flow.draft.filing;
  const caseRequests = caseRecord
    ? requests.filter((request) => request.caseId === caseRecord.id)
    : [];
  const closingTitle =
    flow.draft.closing === null
      ? null
      : (caseRequests.find((request) => request.id === flow.draft.closing?.requestId)?.title ??
        'Request');
  return (
    <View style={styles.container} testID="case-review">
      <AppText variant="title" accessibilityRole="header">
        Case
      </AppText>

      <ScopedStates
        state={state}
        testIDPrefix="case-review"
        loadingLabel="Loading case"
        error={error}
        onRetry={onRetry}
        onSwitchScope={onSwitchScope}
      />

      {state === 'empty' ? (
        <EmptyState
          title="Case not found here"
          body="This case is not part of the workspace you are viewing."
          testID="case-review-empty"
        />
      ) : null}

      {state === 'ready' && caseRecord && !staff ? (
        <Notice
          tone="info"
          title="This page is for Honeybee staff"
          body="Your case's status and next action are on Home."
          testID="case-review-staff-only"
        />
      ) : null}

      {state === 'ready' && caseRecord && presentation && staff ? (
        <>
          <View style={styles.heading} testID="case-review-ready">
            <AppText variant="heading">{caseRecord.title}</AppText>
            <StatusBadge
              kind={presentation.kind}
              label={presentation.label}
              testID="case-review-status"
            />
            <AppText variant="caption" tone="secondary">
              {`Status changed ${formatServerTimestamp(caseRecord.statusChangedAt)} · case version ${caseRecord.version}`}
            </AppText>
          </View>

          <RequestsSection
            requests={caseRequests}
            role={role}
            offersClose={canAct(flow)}
            onCloseRequest={onCloseRequest}
          />
          <PackageSection current={current} requests={requests} />
          <ReviewsSection reviews={reviews} />
          <ApprovalsSection approvals={approvals} />
          <SourcesSection references={references} />
          <RecordSection receipts={receipts} documents={documents} />

          <View style={[styles.section, { borderTopColor: colors.divider }]}>
            <AppText variant="subheading" accessibilityRole="header">
              Your action
            </AppText>
            {actions.length === 0 ? (
              <AppText variant="body" tone="secondary" testID="case-review-no-action">
                Nothing for you to do on this case right now.
              </AppText>
            ) : null}

            {showsVerdictForm ? (
              <View style={styles.verdicts} testID="case-review-verdict-form">
                <AppText variant="labelSmall">Verdict</AppText>
                {verdicts.map((verdict) => (
                  <Button
                    key={verdict}
                    kind={flow.draft.verdict === verdict ? 'primary' : 'secondary'}
                    label={
                      flow.draft.verdict === verdict
                        ? `${VERDICT_PRESENTATION[verdict].label} (chosen)`
                        : VERDICT_PRESENTATION[verdict].label
                    }
                    onPress={() => onChooseVerdict(verdict)}
                    accessibilityHint="Chooses this verdict; nothing is recorded until you confirm"
                    testID={VERDICT_TEST_IDS[verdict]}
                  />
                ))}
                <TextField
                  label="Note for the record"
                  value={flow.draft.note}
                  onChangeText={onChangeNote}
                  multiline
                  numberOfLines={4}
                  maxLength={NOTE_LIMITS.maxLength}
                  autoCapitalize="sentences"
                  autoCorrect
                  helperText={`${formatCount(noteLength(flow.draft.note))} of ${formatCount(NOTE_LIMITS.maxLength)} characters. Staff of this workspace read it; the client never does.`}
                  testID="case-review-note"
                  labelTestID="case-review-note-label"
                />
              </View>
            ) : null}

            {showsFilingForm ? (
              <View style={styles.filing} testID="case-review-filing-form">
                <AppText variant="labelSmall">Document filed</AppText>
                {filable.length === 0 ? (
                  <AppText variant="caption" tone="secondary" testID="case-review-no-filable">
                    No checked document on this case can be filed.
                  </AppText>
                ) : (
                  filable.map((document) => (
                    <Button
                      key={document.id}
                      kind={filing.documentId === document.id ? 'primary' : 'secondary'}
                      label={
                        filing.documentId === document.id
                          ? `${document.displayName} (chosen)`
                          : document.displayName
                      }
                      onPress={() => onChooseFilingDocument(document.id)}
                      accessibilityHint="Names the document you filed; nothing is recorded until you confirm"
                      testID={`case-review-filing-doc-${document.id}`}
                    />
                  ))
                )}
                <TextField
                  label="Drive file id"
                  value={filing.driveFileId}
                  onChangeText={onChangeFileId}
                  maxLength={128}
                  helperText="Exactly as Drive shows it. HIVE reads it back; it never writes to Drive."
                  testID="case-review-filing-file-id"
                  labelTestID="case-review-filing-file-id-label"
                />
                <TextField
                  label="Drive folder path"
                  value={filing.drivePath}
                  onChangeText={onChangePath}
                  maxLength={FILING_LIMITS.pathMaxLength}
                  autoCapitalize="sentences"
                  helperText={`${formatCount(noteLength(filing.drivePath))} of ${formatCount(FILING_LIMITS.pathMaxLength)} characters.`}
                  testID="case-review-filing-path"
                  labelTestID="case-review-filing-path-label"
                />
              </View>
            ) : null}

            {flow.name === 'confirming' ? (
              <>
                {flow.action === 'record_verdict' && flow.draft.verdict ? (
                  <View
                    style={[styles.panel, { backgroundColor: colors.panelInfoBackground }]}
                    testID="case-review-confirm-verdict"
                  >
                    <AppText variant="bodyStrong" style={{ color: colors.panelInfoText }}>
                      {`Verdict: ${VERDICT_PRESENTATION[flow.draft.verdict].label}`}
                    </AppText>
                    {flow.draft.note ? (
                      <AppText variant="body" style={{ color: colors.panelInfoText }}>
                        {flow.draft.note}
                      </AppText>
                    ) : null}
                  </View>
                ) : null}
                {flow.action === 'approve' && current ? (
                  <View
                    style={[styles.panel, { backgroundColor: colors.panelInfoBackground }]}
                    testID="case-review-confirm-binding"
                  >
                    <AppText variant="bodyStrong" style={{ color: colors.panelInfoText }}>
                      {`Package ${current.packageNumber}, case version ${caseRecord.version}`}
                    </AppText>
                    <AppText variant="caption" style={{ color: colors.panelInfoText }}>
                      {`Digest ${current.manifestDigest}`}
                    </AppText>
                    <AppText variant="caption" style={{ color: colors.panelInfoText }}>
                      {`Destination: ${DESTINATION_LABEL['hive-record']}. Expires 30 days after approval.`}
                    </AppText>
                  </View>
                ) : null}
                {flow.action === 'close_request' && closingTitle ? (
                  <View
                    style={[styles.panel, { backgroundColor: colors.panelInfoBackground }]}
                    testID="case-review-confirm-close"
                  >
                    <AppText variant="bodyStrong" style={{ color: colors.panelInfoText }}>
                      {closingTitle}
                    </AppText>
                  </View>
                ) : null}
                {flow.action === 'record_filing' && flow.draft.filing.documentId ? (
                  <View
                    style={[styles.panel, { backgroundColor: colors.panelInfoBackground }]}
                    testID="case-review-confirm-filing"
                  >
                    <AppText variant="bodyStrong" style={{ color: colors.panelInfoText }}>
                      {documentName(documents, flow.draft.filing.documentId)}
                    </AppText>
                    <AppText variant="caption" style={{ color: colors.panelInfoText }}>
                      {`Drive file ${flow.draft.filing.driveFileId.trim()}`}
                    </AppText>
                    <AppText variant="caption" style={{ color: colors.panelInfoText }}>
                      {`At ${flow.draft.filing.drivePath.trim()}`}
                    </AppText>
                    <AppText variant="caption" style={{ color: colors.panelInfoText }}>
                      {`Case version ${caseRecord.version}. The document's checked digest is what the record must hold.`}
                    </AppText>
                  </View>
                ) : null}
                <Notice
                  tone="info"
                  title={CASE_ACTION_CONFIRMATION[flow.action].title}
                  body={CASE_ACTION_CONFIRMATION[flow.action].body}
                  testID="case-review-confirm-notice"
                />
              </>
            ) : null}

            {flow.name === 'running' ? (
              <LoadingState label={RUNNING_LABEL[flow.action]} testID="case-review-running" />
            ) : null}

            {flow.name === 'done' ? (
              <Notice
                tone="success"
                title={CASE_ACTION_DONE[flow.action].title}
                body={CASE_ACTION_DONE[flow.action].body}
                testID="case-review-done"
              />
            ) : null}

            {flow.name === 'refused' ? (
              <Notice
                tone="warning"
                title={REVIEW_REFUSAL_WORDING[flow.refusal].title}
                body={REVIEW_REFUSAL_WORDING[flow.refusal].body}
                testID="case-review-refused"
              />
            ) : null}

            {flow.name === 'failed' ? (
              <Notice
                tone="danger"
                title="The action was not recorded"
                body={flow.error.userMessage}
                testID="case-review-failed"
              />
            ) : null}

            <View style={styles.actions}>
              {canAct(flow)
                ? actions.map((action) =>
                    isNavigationAction(action) ? (
                      onAddRequest ? (
                        <Button
                          key={action}
                          kind={action === primary ? 'primary' : 'secondary'}
                          label={caseActionLabel(action, caseRecord.status)}
                          onPress={onAddRequest}
                          accessibilityHint="Opens the screen where you ask the client for a document or an answer"
                          testID={CASE_ACTION_TEST_IDS[action]}
                        />
                      ) : null
                    ) : (
                      <Button
                        key={action}
                        kind={action === primary ? 'primary' : 'secondary'}
                        label={caseActionLabel(action, caseRecord.status)}
                        onPress={() => onRequestAction(action)}
                        accessibilityHint="Asks you to confirm before anything is recorded"
                        testID={CASE_ACTION_TEST_IDS[action]}
                      />
                    ),
                  )
                : null}
              {flow.name === 'confirming' ? (
                <>
                  <Button
                    label="Confirm"
                    onPress={onConfirm}
                    accessibilityHint="Records the action; the case moves on the server"
                    testID="case-review-confirm"
                  />
                  <Button
                    kind="secondary"
                    label="Cancel"
                    onPress={onCancel}
                    testID="case-review-cancel"
                  />
                </>
              ) : null}
              {flow.name === 'refused' ? (
                isStaleRefusal(flow.refusal) ? (
                  <Button label="Refresh the case" onPress={onRetry} testID="case-review-refresh" />
                ) : (
                  <Button label="Keep editing" onPress={onDismiss} testID="case-review-dismiss" />
                )
              ) : null}
              {flow.name === 'failed' ? (
                <>
                  <Button label="Try again" onPress={onTryAgain} testID="case-review-retry" />
                  <Button
                    kind="secondary"
                    label="Keep editing"
                    onPress={onDismiss}
                    testID="case-review-dismiss"
                  />
                </>
              ) : null}
            </View>
          </View>
        </>
      ) : null}

      {!busy ? (
        <Button kind="secondary" label="Back to Home" onPress={onBack} testID="case-review-back" />
      ) : null}
    </View>
  );
}
