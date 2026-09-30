/** Asking the client for something (WO-013): intake or the preparer opens
 * a request on a case that is received or gathering evidence. A title the
 * client reads on Requests, a detail they read on the request, a due date
 * from four choices, and, for a question, the checked document it is
 * about. One primary action, an explicit confirmation, a refusal that
 * says why. Pure and props-driven. */
import React from 'react';
import { StyleSheet, View } from 'react-native';

import type { SafeError } from '@/core/errors';
import { formatCount } from '@/core/text';
import type { DocumentSummary } from '@/data/supabase/documents';
import type { CaseRecord, OpenedRequest } from '@/data/supabase/reviews';
import { CASE_STATUS_PRESENTATION, INTAKE_REFUSAL_WORDING } from '@/features/shared/labels';
import { ScopedStates } from '@/features/shared/ScopedStates';
import type { ScopedLoadStateName } from '@/features/shared/useScopedLoad';
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
import { radii, spacing } from '@/ui/tokens';

import { type CreationState, canEdit, isCreationBusy, isStaleCreationRefusal } from './intake-flow';
import {
  DETAIL_LIMITS,
  DUE_CHOICES,
  type DueChoice,
  type RequestDraft,
  TITLE_LIMITS,
  cleanTitle,
  detailLength,
  dueChoiceLabel,
  subjectDocuments,
  titleLength,
} from './intake-rules';

export type NewRequestFlowState = CreationState<RequestDraft, OpenedRequest>;

export interface NewRequestViewProps {
  state: ScopedLoadStateName;
  caseRecord?: CaseRecord | null;
  documents: readonly DocumentSummary[];
  /** Whether the viewer's role may ask on this case in its status. */
  allowed: boolean;
  flow: NewRequestFlowState;
  error?: SafeError;
  onRetry: () => void;
  onSwitchScope?: () => void;
  onChangeTitle: (title: string) => void;
  onChangeDetail: (detail: string) => void;
  onChooseDue: (choice: DueChoice) => void;
  onChooseDocument: (documentId: string | null) => void;
  onRequest: () => void;
  onConfirm: () => void;
  onCancel: () => void;
  onDismiss: () => void;
  onTryAgain: () => void;
  /** Back to the case, after a request is opened or at any other time. */
  onBack: () => void;
}

/** Literal test ids in the table form the flow validator reads. */
const DUE_TEST_IDS = {
  none: 'new-request-due-none',
  7: 'new-request-due-7',
  14: 'new-request-due-14',
  30: 'new-request-due-30',
} as const;

function dueTestId(choice: DueChoice): string {
  return choice === null ? DUE_TEST_IDS.none : DUE_TEST_IDS[choice];
}

const styles = StyleSheet.create({
  container: { gap: spacing.lg },
  form: { gap: spacing.md },
  choices: { gap: spacing.sm },
  panel: { borderRadius: radii.lg, padding: spacing.md, gap: spacing.xs },
  actions: { gap: spacing.md },
});

export function NewRequestView({
  state,
  caseRecord,
  documents,
  allowed,
  flow,
  error,
  onRetry,
  onSwitchScope,
  onChangeTitle,
  onChangeDetail,
  onChooseDue,
  onChooseDocument,
  onRequest,
  onConfirm,
  onCancel,
  onDismiss,
  onTryAgain,
  onBack,
}: NewRequestViewProps): React.JSX.Element {
  const colors = useThemeColors();
  const busy = isCreationBusy(flow);
  const presentation = caseRecord ? CASE_STATUS_PRESENTATION[caseRecord.status] : null;
  const checked = subjectDocuments(documents);
  const chosenDocument = checked.find((document) => document.id === flow.draft.subjectDocumentId);
  return (
    <View style={styles.container} testID="new-request">
      <AppText variant="title" accessibilityRole="header">
        Ask the client for something
      </AppText>

      <ScopedStates
        state={state}
        testIDPrefix="new-request"
        loadingLabel="Loading case"
        error={error}
        onRetry={onRetry}
        onSwitchScope={onSwitchScope}
      />

      {state === 'empty' ? (
        <EmptyState
          title="Case not found here"
          body="This case is not part of the workspace you are viewing."
          testID="new-request-empty"
        />
      ) : null}

      {state === 'ready' && caseRecord && presentation ? (
        <View style={styles.form} testID="new-request-form">
          <AppText variant="heading">{caseRecord.title}</AppText>
          <StatusBadge kind={presentation.kind} label={presentation.label} />

          {!allowed ? (
            <Notice
              tone="info"
              title="This case is not taking requests right now"
              body="Requests are opened by intake or the preparer once the intake is recorded and while evidence is being gathered."
              testID="new-request-not-allowed"
            />
          ) : null}

          {allowed && canEdit(flow) ? (
            <>
              <TextField
                label="What you are asking for"
                value={flow.draft.title}
                onChangeText={onChangeTitle}
                maxLength={TITLE_LIMITS.maxLength}
                autoCapitalize="sentences"
                autoCorrect
                helperText={`${formatCount(titleLength(flow.draft.title))} of ${formatCount(TITLE_LIMITS.maxLength)} characters. The client reads this on Requests.`}
                testID="new-request-title"
                labelTestID="new-request-title-label"
              />
              <TextField
                label="Detail"
                value={flow.draft.detail}
                onChangeText={onChangeDetail}
                multiline
                numberOfLines={4}
                maxLength={DETAIL_LIMITS.maxLength}
                autoCapitalize="sentences"
                autoCorrect
                helperText={`${formatCount(detailLength(flow.draft.detail))} of ${formatCount(DETAIL_LIMITS.maxLength)} characters. Optional. The client reads it on the request.`}
                testID="new-request-detail"
                labelTestID="new-request-detail-label"
              />
              <View style={styles.choices} testID="new-request-due">
                <AppText variant="labelSmall">Due</AppText>
                {DUE_CHOICES.map((choice) => (
                  <Button
                    key={String(choice)}
                    kind={flow.draft.dueInDays === choice ? 'primary' : 'secondary'}
                    label={
                      flow.draft.dueInDays === choice
                        ? `${dueChoiceLabel(choice)} (chosen)`
                        : dueChoiceLabel(choice)
                    }
                    onPress={() => onChooseDue(choice)}
                    accessibilityHint="Chooses the due date; nothing is opened until you confirm"
                    testID={dueTestId(choice)}
                  />
                ))}
              </View>
              {checked.length > 0 ? (
                <View style={styles.choices} testID="new-request-subject">
                  <AppText variant="labelSmall">About a document (optional)</AppText>
                  <Button
                    kind={flow.draft.subjectDocumentId === null ? 'primary' : 'secondary'}
                    label={flow.draft.subjectDocumentId === null ? 'None (chosen)' : 'None'}
                    onPress={() => onChooseDocument(null)}
                    testID="new-request-subject-none"
                  />
                  {checked.map((document) => (
                    <Button
                      key={document.id}
                      kind={flow.draft.subjectDocumentId === document.id ? 'primary' : 'secondary'}
                      label={
                        flow.draft.subjectDocumentId === document.id
                          ? `${document.displayName} (chosen)`
                          : document.displayName
                      }
                      onPress={() => onChooseDocument(document.id)}
                      accessibilityHint="Makes the request a question about this checked document"
                      testID={`new-request-subject-${document.id}`}
                    />
                  ))}
                </View>
              ) : null}
            </>
          ) : null}

          {flow.name === 'confirming' ? (
            <>
              <View
                style={[styles.panel, { backgroundColor: colors.panelInfoBackground }]}
                testID="new-request-confirm-panel"
              >
                <AppText variant="bodyStrong" style={{ color: colors.panelInfoText }}>
                  {cleanTitle(flow.draft.title)}
                </AppText>
                {flow.draft.detail.trim() ? (
                  <AppText variant="body" style={{ color: colors.panelInfoText }}>
                    {flow.draft.detail.trim()}
                  </AppText>
                ) : null}
                <AppText variant="caption" style={{ color: colors.panelInfoText }}>
                  {dueChoiceLabel(flow.draft.dueInDays)}
                  {chosenDocument ? ` · about ${chosenDocument.displayName}` : ''}
                </AppText>
              </View>
              <Notice
                tone="info"
                title="Open this request for the client?"
                body={
                  caseRecord.status === 'INTAKE_RECORDED'
                    ? 'The client sees it on their Requests, and the case moves to waiting on documents.'
                    : 'The client sees it on their Requests. The case stays where it is.'
                }
                testID="new-request-confirm-notice"
              />
            </>
          ) : null}

          {flow.name === 'running' ? (
            <LoadingState label="Opening the request" testID="new-request-running" />
          ) : null}

          {flow.name === 'done' ? (
            <Notice
              tone="success"
              title="Request opened"
              body="The client sees it on their Requests."
              testID="new-request-done"
            />
          ) : null}

          {flow.name === 'refused' ? (
            <Notice
              tone="warning"
              title={INTAKE_REFUSAL_WORDING[flow.refusal].title}
              body={INTAKE_REFUSAL_WORDING[flow.refusal].body}
              testID="new-request-refused"
            />
          ) : null}

          {flow.name === 'failed' ? (
            <Notice
              tone="danger"
              title="The request was not opened"
              body={flow.error.userMessage}
              testID="new-request-failed"
            />
          ) : null}

          <View style={styles.actions}>
            {allowed && canEdit(flow) ? (
              <Button
                label="Open request"
                onPress={onRequest}
                accessibilityHint="Asks you to confirm before the request is opened"
                testID="new-request-open"
              />
            ) : null}
            {flow.name === 'confirming' ? (
              <>
                <Button
                  label="Confirm"
                  onPress={onConfirm}
                  accessibilityHint="Opens the request on the server; the client sees it"
                  testID="new-request-confirm"
                />
                <Button
                  kind="secondary"
                  label="Cancel"
                  onPress={onCancel}
                  testID="new-request-cancel"
                />
              </>
            ) : null}
            {flow.name === 'done' ? (
              <Button label="Back to the case" onPress={onBack} testID="new-request-done-back" />
            ) : null}
            {flow.name === 'refused' ? (
              isStaleCreationRefusal(flow.refusal) ? (
                <Button label="Back to the case" onPress={onBack} testID="new-request-back-stale" />
              ) : (
                <Button label="Keep editing" onPress={onDismiss} testID="new-request-dismiss" />
              )
            ) : null}
            {flow.name === 'failed' ? (
              <>
                <Button label="Try again" onPress={onTryAgain} testID="new-request-retry" />
                <Button
                  kind="secondary"
                  label="Keep editing"
                  onPress={onDismiss}
                  testID="new-request-dismiss"
                />
              </>
            ) : null}
          </View>
        </View>
      ) : null}

      {!busy && flow.name !== 'done' ? (
        <Button
          kind="secondary"
          label="Back to the case"
          onPress={onBack}
          testID="new-request-back"
        />
      ) : null}
    </View>
  );
}
