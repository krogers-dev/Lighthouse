/** Answer a request (WO-004).
 *
 * One primary action at a time, and every state explicit: write the
 * answer and refer to the request's received documents; save it as a
 * draft that stays with the request; submit it through one explicit
 * confirmation that says what submitting means. A refusal says why and
 * what to do; a failure keeps the draft on screen so it can be sent
 * again. Nothing here says approved, reviewed, or decided: a submitted
 * answer is a HIVE record Honeybee will read, and the request shows as
 * answered.
 *
 * The screen renders the flow only for a client user on an open request
 * without a submitted answer; the route can be reached in any other case
 * (a deep link, a request that closed meanwhile), and then the screen
 * says so and offers the way back rather than a control that would be
 * refused. */
import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import type { SafeError } from '@/core/errors';
import type { DocumentSummary } from '@/data/supabase/documents';
import type { RequestDetail } from '@/data/supabase/repositories';
import {
  ANSWER_REFUSAL_WORDING,
  DOCUMENT_STATUS_PRESENTATION,
  REQUEST_STATUS_PRESENTATION,
} from '@/features/shared/labels';
import { ScopedStates } from '@/features/shared/ScopedStates';
import type { ScopedLoadStateName } from '@/features/shared/useScopedLoad';
import {
  AppText,
  Button,
  LoadingState,
  Notice,
  StatusBadge,
  TextField,
  useThemeColors,
} from '@/ui';
import { layout, radii, spacing, touchTarget } from '@/ui/tokens';

import {
  type AnswerDraft,
  type AnswerFlowState,
  type SubmitStep,
  canKeepEditing,
  canSave,
  canSubmit,
  isBusy,
} from './answer-flow';
import { ANSWER_LIMITS, answerLength, formatCount } from './answer-rules';

export interface AnswerViewProps {
  /** The request load: this screen needs the request's version, status,
   * documents, and draft before it can act, so it carries the same
   * states as every read. */
  state: ScopedLoadStateName;
  request?: RequestDetail | null;
  /** The document the request is about, resolved inside the scope. */
  subjectDocument?: DocumentSummary | null;
  /** The documents the answer may refer to (received on this request). */
  citable: readonly DocumentSummary[];
  /** Decided by the screen from server-confirmed facts (role, status,
   * the answer's state). When false the screen explains and offers the
   * way back. */
  canAnswer: boolean;
  flow: AnswerFlowState;
  error?: SafeError;
  onRetry: () => void;
  onSwitchScope?: () => void;
  onChangeText: (body: string) => void;
  onToggleCitation: (documentId: string) => void;
  onSave: () => void;
  onSubmit: () => void;
  onConfirm: () => void;
  onCancel: () => void;
  onDismiss: () => void;
  onTryAgain: () => void;
  onBack: () => void;
}

const SUBMIT_STEP_LABEL: Record<SubmitStep, string> = {
  saving: 'Saving your answer',
  submitting: 'Submitting your answer',
};

const styles = StyleSheet.create({
  container: { gap: spacing.lg },
  heading: { gap: spacing.xs },
  context: {
    gap: spacing.sm,
    paddingTop: spacing.md,
    borderTopWidth: layout.hairline,
  },
  flow: { gap: spacing.lg },
  citations: { gap: spacing.xs },
  citationRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderTopWidth: layout.hairline,
    minHeight: touchTarget.minHeight,
  },
  citationBody: { flex: 1, gap: spacing.xs },
  panel: {
    borderRadius: radii.lg,
    padding: spacing.md,
    gap: spacing.xs,
  },
  actions: { gap: spacing.md },
  focused: {
    outlineStyle: 'solid',
    outlineWidth: layout.focusRingWidth,
    outlineOffset: layout.focusRingOffset,
  },
});

function CitationRow({
  document,
  checked,
  disabled,
  onToggle,
}: {
  document: DocumentSummary;
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
}): React.JSX.Element {
  const colors = useThemeColors();
  const [focused, setFocused] = useState(false);
  const presentation = DOCUMENT_STATUS_PRESENTATION[document.status];
  // A checkbox row: the state is spoken (checked) and printed ("Referred
  // to"), never carried by the glyph alone.
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled }}
      accessibilityLabel={`${document.displayName}. ${presentation.label}.`}
      accessibilityHint={
        checked
          ? 'Removes this document from your answer'
          : 'Refers to this document in your answer'
      }
      disabled={disabled}
      onPress={onToggle}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      testID={`respond-citation-${document.id}`}
      style={({ pressed }) => [
        styles.citationRow,
        { borderTopColor: colors.divider, opacity: disabled ? 0.6 : pressed ? 0.85 : 1 },
        focused && [styles.focused, { outlineColor: colors.focusRing }],
      ]}
    >
      <AppText variant="heading" importantForAccessibility="no">
        {checked ? '☑' : '☐'}
      </AppText>
      <View style={styles.citationBody}>
        <AppText variant="bodyStrong">{document.displayName}</AppText>
        <AppText variant="caption" tone="secondary">
          {checked ? `${presentation.label}. Referred to in your answer` : presentation.label}
        </AppText>
      </View>
    </Pressable>
  );
}

function citedNames(draft: AnswerDraft, citable: readonly DocumentSummary[]): string[] {
  return draft.citedDocumentIds
    .map((id) => citable.find((document) => document.id === id)?.displayName ?? null)
    .filter((name): name is string => name !== null);
}

/** The draft, read-only: shown while confirming and beside a refusal or
 * a failure, so what was written is never out of sight. */
function DraftPanel({
  draft,
  citable,
  caption,
  testID,
}: {
  draft: AnswerDraft;
  citable: readonly DocumentSummary[];
  caption: string;
  testID: string;
}): React.JSX.Element {
  const colors = useThemeColors();
  const names = citedNames(draft, citable);
  return (
    <View style={[styles.panel, { backgroundColor: colors.panelInfoBackground }]} testID={testID}>
      <AppText variant="body" style={{ color: colors.panelInfoText }}>
        {draft.body}
      </AppText>
      {names.length > 0 ? (
        <AppText variant="caption" style={{ color: colors.panelInfoText }}>
          {`Refers to: ${names.join(', ')}`}
        </AppText>
      ) : null}
      <AppText variant="caption" style={{ color: colors.panelInfoText }}>
        {caption}
      </AppText>
    </View>
  );
}

export function AnswerView({
  state,
  request,
  subjectDocument,
  citable,
  canAnswer,
  flow,
  error,
  onRetry,
  onSwitchScope,
  onChangeText,
  onToggleCitation,
  onSave,
  onSubmit,
  onConfirm,
  onCancel,
  onDismiss,
  onTryAgain,
  onBack,
}: AnswerViewProps): React.JSX.Element {
  const colors = useThemeColors();
  const presentation = request ? REQUEST_STATUS_PRESENTATION[request.status] : null;
  const busy = isBusy(flow);
  const editing = flow.name === 'editing' || flow.name === 'saving';
  const length = answerLength(flow.draft.body);
  return (
    <View style={styles.container} testID="respond">
      <View style={styles.heading}>
        <AppText variant="title" accessibilityRole="header">
          Answer this request
        </AppText>
        <AppText variant="caption" tone="secondary">
          {`Your answer stays with the request as a draft until you submit it. Up to ${formatCount(ANSWER_LIMITS.maxLength)} characters.`}
        </AppText>
      </View>

      <ScopedStates
        state={state}
        testIDPrefix="respond"
        loadingLabel="Loading request"
        error={error}
        onRetry={onRetry}
        onSwitchScope={onSwitchScope}
      />

      {state === 'empty' ? (
        <Notice
          tone="info"
          title="Request not found here"
          body="This request is not part of the workspace you are viewing."
          testID="respond-empty"
        />
      ) : null}

      {state === 'ready' && request && presentation ? (
        <View style={[styles.context, { borderTopColor: colors.divider }]}>
          <AppText variant="caption" tone="secondary">
            For this request
          </AppText>
          <AppText variant="heading" testID="respond-request-title">
            {request.title}
          </AppText>
          <StatusBadge kind={presentation.kind} label={presentation.label} />
          <AppText variant="body">{request.detail}</AppText>
          {subjectDocument ? (
            <AppText variant="caption" tone="secondary" testID="respond-subject">
              {`About: ${subjectDocument.displayName}`}
            </AppText>
          ) : null}
        </View>
      ) : null}

      {state === 'ready' && request && !canAnswer ? (
        <Notice
          tone="info"
          title="This request is not taking an answer right now"
          body="It may have been answered or closed. Go back to the request to see its current status."
          testID="respond-unavailable"
        />
      ) : null}

      {state === 'ready' && request && canAnswer ? (
        <View style={styles.flow}>
          {editing ? (
            <>
              <TextField
                label="Your answer"
                value={flow.draft.body}
                onChangeText={onChangeText}
                multiline
                numberOfLines={6}
                maxLength={ANSWER_LIMITS.maxLength}
                autoCapitalize="sentences"
                autoCorrect
                editable={!busy}
                helperText={`${formatCount(length)} of ${formatCount(ANSWER_LIMITS.maxLength)} characters`}
                testID="respond-text"
                labelTestID="respond-text-label"
              />
              <View style={styles.citations}>
                <AppText variant="subheading" accessibilityRole="header">
                  Documents this answer refers to
                </AppText>
                {citable.length > 0 ? (
                  citable.map((document) => (
                    <CitationRow
                      key={document.id}
                      document={document}
                      checked={flow.draft.citedDocumentIds.includes(document.id)}
                      disabled={busy}
                      onToggle={() => onToggleCitation(document.id)}
                    />
                  ))
                ) : (
                  <AppText variant="body" tone="secondary" testID="respond-citations-empty">
                    No documents on this request to refer to yet.
                  </AppText>
                )}
              </View>
            </>
          ) : null}

          {flow.name === 'editing' && flow.notice === 'saved' ? (
            <Notice
              tone="success"
              title="Draft saved"
              body="Your draft is kept with the request. Nothing has been submitted."
              testID="respond-saved"
            />
          ) : null}
          {flow.name === 'saving' ? (
            <LoadingState label="Saving your draft" testID="respond-saving" />
          ) : null}
          {flow.name === 'submitting' ? (
            <LoadingState label={SUBMIT_STEP_LABEL[flow.step]} testID="respond-submitting" />
          ) : null}

          {flow.name === 'confirming' ? (
            <>
              <DraftPanel
                draft={flow.draft}
                citable={citable}
                caption="Not submitted yet."
                testID="respond-review"
              />
              <Notice
                tone="info"
                title="Submit this answer?"
                body="Once submitted it cannot be changed, and Honeybee will see it. The request will show as answered."
                testID="respond-confirm-notice"
              />
            </>
          ) : null}

          {flow.name === 'submitted' ? (
            <>
              <Notice
                tone="success"
                title="Answer submitted"
                body="The request now shows as answered. Honeybee will follow up if anything else is needed."
                testID="respond-submitted"
              />
              <DraftPanel
                draft={flow.draft}
                citable={citable}
                caption="Submitted to Honeybee."
                testID="respond-submitted-answer"
              />
            </>
          ) : null}

          {flow.name === 'refused' ? (
            <>
              <Notice
                tone="warning"
                title={ANSWER_REFUSAL_WORDING[flow.refusal].title}
                body={ANSWER_REFUSAL_WORDING[flow.refusal].body}
                testID="respond-refused"
              />
              {flow.draft.body !== '' ? (
                <DraftPanel
                  draft={flow.draft}
                  citable={citable}
                  caption="Not submitted."
                  testID="respond-refused-answer"
                />
              ) : null}
            </>
          ) : null}

          {flow.name === 'failed' ? (
            <>
              <Notice
                tone="danger"
                title={
                  flow.during === 'save'
                    ? 'The draft was not saved'
                    : 'The answer was not submitted'
                }
                body={flow.error.userMessage}
                testID="respond-failed"
              />
              <DraftPanel
                draft={flow.draft}
                citable={citable}
                caption="Still on this phone, ready to try again."
                testID="respond-failed-answer"
              />
            </>
          ) : null}

          <View style={styles.actions}>
            {canSubmit(flow) ? (
              <Button
                label="Submit answer"
                onPress={onSubmit}
                accessibilityHint="Asks you to confirm before the answer is submitted to Honeybee"
                testID="respond-submit"
              />
            ) : null}
            {canSave(flow) ? (
              <Button
                kind="secondary"
                label="Save draft"
                onPress={onSave}
                accessibilityHint="Keeps your draft with the request without submitting it"
                testID="respond-save"
              />
            ) : null}
            {flow.name === 'confirming' ? (
              <>
                <Button
                  label="Submit"
                  onPress={onConfirm}
                  accessibilityHint="Submits the answer to Honeybee; it cannot be changed afterwards"
                  testID="respond-confirm"
                />
                <Button
                  kind="secondary"
                  label="Keep editing"
                  onPress={onCancel}
                  testID="respond-cancel"
                />
              </>
            ) : null}
            {flow.name === 'failed' ? (
              <>
                <Button label="Try again" onPress={onTryAgain} testID="respond-retry" />
                <Button
                  kind="secondary"
                  label="Keep editing"
                  onPress={onDismiss}
                  testID="respond-dismiss"
                />
              </>
            ) : null}
            {flow.name === 'refused' && canKeepEditing(flow.refusal) ? (
              <Button label="Keep editing" onPress={onDismiss} testID="respond-dismiss" />
            ) : null}
          </View>
        </View>
      ) : null}

      {/* Safe back at every moment except mid-write, when leaving would
          drop a receipt the screen has not yet shown. */}
      {!busy ? (
        <Button
          kind="secondary"
          label="Back to the request"
          onPress={onBack}
          testID="respond-back"
        />
      ) : null}
    </View>
  );
}
