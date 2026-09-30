/** Opening a case (WO-013): intake gives the matter its title and opens it
 * as a draft the client sees as "being set up". One field, one primary
 * action, an explicit confirmation that says what the client will see,
 * and a refusal that says why. Pure and props-driven. */
import React from 'react';
import { StyleSheet, View } from 'react-native';

import type { SafeError } from '@/core/errors';
import { formatCount } from '@/core/text';
import type { OpenedCase } from '@/data/supabase/reviews';
import { CASE_STATUS_PRESENTATION, INTAKE_REFUSAL_WORDING } from '@/features/shared/labels';
import { ScopedStates } from '@/features/shared/ScopedStates';
import type { ScopedLoadStateName } from '@/features/shared/useScopedLoad';
import { AppText, Button, LoadingState, Notice, TextField, useThemeColors } from '@/ui';
import { radii, spacing } from '@/ui/tokens';

import { type CreationState, canEdit, isCreationBusy, isStaleCreationRefusal } from './intake-flow';
import { type CaseDraft, TITLE_LIMITS, cleanTitle, titleLength } from './intake-rules';

export type NewCaseFlowState = CreationState<CaseDraft, OpenedCase>;

export interface NewCaseViewProps {
  state: ScopedLoadStateName;
  workspaceName: string;
  /** Whether the viewer's role may open a case here (intake). */
  allowed: boolean;
  flow: NewCaseFlowState;
  error?: SafeError;
  onRetry: () => void;
  onSwitchScope?: () => void;
  onChangeTitle: (title: string) => void;
  onRequest: () => void;
  onConfirm: () => void;
  onCancel: () => void;
  onDismiss: () => void;
  onTryAgain: () => void;
  onOpened: (caseId: string) => void;
  onBack: () => void;
}

const styles = StyleSheet.create({
  container: { gap: spacing.lg },
  form: { gap: spacing.md },
  panel: { borderRadius: radii.lg, padding: spacing.md, gap: spacing.xs },
  actions: { gap: spacing.md },
});

export function NewCaseView({
  state,
  workspaceName,
  allowed,
  flow,
  error,
  onRetry,
  onSwitchScope,
  onChangeTitle,
  onRequest,
  onConfirm,
  onCancel,
  onDismiss,
  onTryAgain,
  onOpened,
  onBack,
}: NewCaseViewProps): React.JSX.Element {
  const colors = useThemeColors();
  const busy = isCreationBusy(flow);
  return (
    <View style={styles.container} testID="new-case">
      <AppText variant="title" accessibilityRole="header">
        Open a case
      </AppText>
      <AppText variant="body" tone="secondary">
        {`For ${workspaceName}.`}
      </AppText>

      <ScopedStates
        state={state}
        testIDPrefix="new-case"
        loadingLabel="Loading workspace"
        error={error}
        onRetry={onRetry}
        onSwitchScope={onSwitchScope}
      />

      {state === 'ready' && !allowed ? (
        <Notice
          tone="info"
          title="This page is for intake staff"
          body="Cases are opened by intake. Your workspace's cases are on Home."
          testID="new-case-not-allowed"
        />
      ) : null}

      {state === 'ready' && allowed ? (
        <View style={styles.form} testID="new-case-form">
          {canEdit(flow) ? (
            <TextField
              label="Case title"
              value={flow.draft.title}
              onChangeText={onChangeTitle}
              maxLength={TITLE_LIMITS.maxLength}
              autoCapitalize="sentences"
              autoCorrect
              helperText={`${formatCount(titleLength(flow.draft.title))} of ${formatCount(TITLE_LIMITS.maxLength)} characters. The client reads this title on Home.`}
              testID="new-case-title"
              labelTestID="new-case-title-label"
            />
          ) : null}

          {flow.name === 'confirming' ? (
            <>
              <View
                style={[styles.panel, { backgroundColor: colors.panelInfoBackground }]}
                testID="new-case-confirm-panel"
              >
                <AppText variant="bodyStrong" style={{ color: colors.panelInfoText }}>
                  {cleanTitle(flow.draft.title)}
                </AppText>
                <AppText variant="caption" style={{ color: colors.panelInfoText }}>
                  {`Shown to the client as "${CASE_STATUS_PRESENTATION.DRAFT.label}" until you record the intake.`}
                </AppText>
              </View>
              <Notice
                tone="info"
                title="Open this case as a draft?"
                body="Nothing is asked of the client yet. Record the intake when the case is set up, then ask them for what is needed."
                testID="new-case-confirm-notice"
              />
            </>
          ) : null}

          {flow.name === 'running' ? (
            <LoadingState label="Opening the case" testID="new-case-running" />
          ) : null}

          {flow.name === 'done' ? (
            <Notice
              tone="success"
              title="Case opened"
              body="The client sees it as being set up. Record the intake when it is ready."
              testID="new-case-done"
            />
          ) : null}

          {flow.name === 'refused' ? (
            <Notice
              tone="warning"
              title={INTAKE_REFUSAL_WORDING[flow.refusal].title}
              body={INTAKE_REFUSAL_WORDING[flow.refusal].body}
              testID="new-case-refused"
            />
          ) : null}

          {flow.name === 'failed' ? (
            <Notice
              tone="danger"
              title="The case was not opened"
              body={flow.error.userMessage}
              testID="new-case-failed"
            />
          ) : null}

          <View style={styles.actions}>
            {canEdit(flow) ? (
              <Button
                label="Open case"
                onPress={onRequest}
                accessibilityHint="Asks you to confirm before the case is opened"
                testID="new-case-open"
              />
            ) : null}
            {flow.name === 'confirming' ? (
              <>
                <Button
                  label="Confirm"
                  onPress={onConfirm}
                  accessibilityHint="Opens the case as a draft on the server"
                  testID="new-case-confirm"
                />
                <Button
                  kind="secondary"
                  label="Cancel"
                  onPress={onCancel}
                  testID="new-case-cancel"
                />
              </>
            ) : null}
            {flow.name === 'done' ? (
              <Button
                label="Go to the case"
                onPress={() => onOpened(flow.result.caseId)}
                testID="new-case-go"
              />
            ) : null}
            {flow.name === 'refused' ? (
              isStaleCreationRefusal(flow.refusal) ? (
                <Button label="Back to Home" onPress={onBack} testID="new-case-back-stale" />
              ) : (
                <Button label="Keep editing" onPress={onDismiss} testID="new-case-dismiss" />
              )
            ) : null}
            {flow.name === 'failed' ? (
              <>
                <Button label="Try again" onPress={onTryAgain} testID="new-case-retry" />
                <Button
                  kind="secondary"
                  label="Keep editing"
                  onPress={onDismiss}
                  testID="new-case-dismiss"
                />
              </>
            ) : null}
          </View>
        </View>
      ) : null}

      {!busy && flow.name !== 'done' ? (
        <Button kind="secondary" label="Back to Home" onPress={onBack} testID="new-case-back" />
      ) : null}
    </View>
  );
}
