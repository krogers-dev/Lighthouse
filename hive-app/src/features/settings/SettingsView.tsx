/** Account and access settings: sign out, identity/workspace switching,
 * plain account-access information, and (WO-007) the account-deletion
 * request.
 *
 * The deletion section renders only when the public page that explains
 * deletion is configured (PRODUCT.md: the control, its authorized
 * backend, the retention explanation, and the public web route exist
 * together or not at all). It asks for the request through one explicit
 * confirmation, shows an open request with the date and the way to
 * withdraw it, words every refusal, and sends a stale screen to reload.
 */
import React from 'react';
import { Linking, StyleSheet, View } from 'react-native';

import type { DeletionRequest } from '@/data/supabase/account';
import {
  DELETION_WORDING,
  deletionRequestedLine,
  formatServerTimestamp,
} from '@/features/shared/labels';
import { AppText, Button, ErrorState, LoadingState, Notice, useThemeColors } from '@/ui';
import { layout, spacing } from '@/ui/tokens';

import { type DeletionFlowState, isStaleDeletionRefusal } from './deletion-flow';
import type { DeletionLoadState } from './useDeletionRequest';

export interface DeletionSectionProps {
  /** The public page that explains deletion; its presence is what shows the section. */
  infoUrl: string;
  load: DeletionLoadState;
  flow: DeletionFlowState;
  onReload: () => void;
  onRequest: () => void;
  onWithdraw: () => void;
  onConfirm: () => void;
  onCancel: () => void;
  onDismiss: () => void;
  onTryAgain: () => void;
}

export interface SettingsViewProps {
  email?: string;
  /** Configured support address (EXPO_PUBLIC_SUPPORT_EMAIL); absent until set. */
  supportEmail?: string;
  workspaceName?: string;
  canSwitchScope: boolean;
  signingOut: boolean;
  /** Absent when the deletion page is not configured: no control at all. */
  deletion?: DeletionSectionProps;
  onSwitchScope: () => void;
  onSignOut: () => void;
  onBack: () => void;
}

const styles = StyleSheet.create({
  container: { gap: spacing.lg },
  heading: { gap: spacing.xs },
  section: {
    gap: spacing.sm,
    paddingTop: spacing.md,
    borderTopWidth: layout.hairline,
  },
  actions: { gap: spacing.sm },
});

function openRequest(load: DeletionLoadState): DeletionRequest | null {
  if (load.name !== 'ready' || !load.latest) return null;
  return load.latest.status === 'REQUESTED' ? load.latest : null;
}

export function DeletionSection({
  infoUrl,
  load,
  flow,
  onReload,
  onRequest,
  onWithdraw,
  onConfirm,
  onCancel,
  onDismiss,
  onTryAgain,
  signingOut,
}: DeletionSectionProps & { signingOut: boolean }): React.JSX.Element {
  const colors = useThemeColors();
  const open = openRequest(load);
  const idle = flow.name === 'idle';
  return (
    <View
      style={[styles.section, { borderTopColor: colors.divider }]}
      testID="settings-deletion-section"
    >
      <AppText variant="heading" accessibilityRole="header">
        Delete your account
      </AppText>
      <AppText variant="body">{DELETION_WORDING.explanation}</AppText>
      <Button
        kind="secondary"
        label={DELETION_WORDING.infoLink}
        onPress={() => void Linking.openURL(infoUrl)}
        accessibilityHint="Opens the page that explains account deletion in your browser"
        disabled={signingOut}
        testID="settings-deletion-info"
      />

      {load.name === 'loading' ? (
        <LoadingState label="Checking for a deletion request" testID="settings-deletion-loading" />
      ) : null}
      {load.name === 'error' ? (
        <ErrorState error={load.error} onRetry={onReload} testID="settings-deletion-error" />
      ) : null}

      {load.name === 'ready' && open ? (
        <Notice
          tone="info"
          title="Deletion requested"
          body={deletionRequestedLine(open.requestedAt)}
          testID="settings-deletion-requested"
        />
      ) : null}
      {load.name === 'ready' && !open && load.latest?.status === 'WITHDRAWN' ? (
        <AppText variant="caption" tone="secondary" testID="settings-deletion-withdrawn">
          {`A previous request was withdrawn ${formatServerTimestamp(load.latest.withdrawnAt ?? load.latest.requestedAt)}.`}
        </AppText>
      ) : null}

      {flow.name === 'confirming' ? (
        <Notice
          tone="warning"
          title={DELETION_WORDING.confirm[flow.action].title}
          body={DELETION_WORDING.confirm[flow.action].body}
          testID="settings-deletion-confirm-notice"
        />
      ) : null}
      {flow.name === 'running' ? (
        <LoadingState
          label={flow.action === 'request' ? 'Recording your request' : 'Withdrawing your request'}
          testID="settings-deletion-running"
        />
      ) : null}
      {flow.name === 'done' ? (
        <Notice
          tone="success"
          title={DELETION_WORDING.done[flow.action].title}
          body={DELETION_WORDING.done[flow.action].body}
          testID="settings-deletion-done"
        />
      ) : null}
      {flow.name === 'refused' ? (
        <Notice
          tone="warning"
          title={DELETION_WORDING.refusals[flow.refusal].title}
          body={DELETION_WORDING.refusals[flow.refusal].body}
          testID="settings-deletion-refused"
        />
      ) : null}
      {flow.name === 'failed' ? (
        <Notice
          tone="danger"
          title="The request was not recorded"
          body={flow.error.userMessage}
          testID="settings-deletion-failed"
        />
      ) : null}

      <View style={styles.actions}>
        {load.name === 'ready' && idle && !open ? (
          <Button
            kind="secondary"
            label={DELETION_WORDING.request}
            onPress={onRequest}
            accessibilityHint="Asks you to confirm before anything is recorded"
            disabled={signingOut}
            testID="settings-deletion-request"
          />
        ) : null}
        {load.name === 'ready' && idle && open ? (
          <Button
            kind="secondary"
            label={DELETION_WORDING.withdraw}
            onPress={onWithdraw}
            accessibilityHint="Asks you to confirm before anything is recorded"
            disabled={signingOut}
            testID="settings-deletion-withdraw"
          />
        ) : null}
        {flow.name === 'confirming' ? (
          <>
            <Button
              label="Confirm"
              onPress={onConfirm}
              accessibilityHint="Records it on the server"
              testID="settings-deletion-confirm"
            />
            <Button
              kind="secondary"
              label="Cancel"
              onPress={onCancel}
              testID="settings-deletion-cancel"
            />
          </>
        ) : null}
        {flow.name === 'done' ? (
          <Button label="OK" onPress={onDismiss} testID="settings-deletion-ok" />
        ) : null}
        {flow.name === 'refused' ? (
          isStaleDeletionRefusal(flow.refusal) ? (
            <Button label="Refresh" onPress={onReload} testID="settings-deletion-refresh" />
          ) : (
            <Button label="Dismiss" onPress={onDismiss} testID="settings-deletion-dismiss" />
          )
        ) : null}
        {flow.name === 'failed' ? (
          <>
            <Button label="Try again" onPress={onTryAgain} testID="settings-deletion-retry" />
            <Button
              kind="secondary"
              label="Dismiss"
              onPress={onDismiss}
              testID="settings-deletion-dismiss"
            />
          </>
        ) : null}
      </View>
    </View>
  );
}

export function SettingsView({
  supportEmail,
  workspaceName,
  canSwitchScope,
  signingOut,
  deletion,
  onSwitchScope,
  onSignOut,
  onBack,
}: SettingsViewProps): React.JSX.Element {
  const colors = useThemeColors();
  return (
    <View style={styles.container}>
      <View style={styles.heading}>
        <AppText variant="title" accessibilityRole="header">
          Account
        </AppText>
        {workspaceName ? (
          <AppText
            variant="caption"
            tone="secondary"
          >{`Current workspace: ${workspaceName}`}</AppText>
        ) : null}
      </View>
      <View style={[styles.section, { borderTopColor: colors.divider }]}>
        <AppText variant="heading" accessibilityRole="header">
          Your access
        </AppText>
        <AppText variant="body">
          Access to HIVE is managed by Honeybee Accounting. To change who can see this workspace,
          contact your Honeybee team.
        </AppText>
      </View>
      <View style={styles.actions}>
        {supportEmail ? (
          <Button
            kind="secondary"
            label={`Email ${supportEmail}`}
            onPress={() => void Linking.openURL(`mailto:${supportEmail}`)}
            accessibilityHint="Opens your email app with a new message to your Honeybee team"
            disabled={signingOut}
            testID="settings-support-email"
          />
        ) : null}
        {canSwitchScope ? (
          <Button
            kind="secondary"
            label="Switch workspace"
            onPress={onSwitchScope}
            disabled={signingOut}
            testID="settings-switch-scope"
          />
        ) : null}
        <Button
          label="Sign out"
          onPress={onSignOut}
          loading={signingOut}
          accessibilityHint="Ends your session on this device"
          testID="settings-sign-out"
        />
        <Button
          kind="secondary"
          label="Back"
          onPress={onBack}
          disabled={signingOut}
          testID="settings-back"
        />
      </View>
      {deletion ? <DeletionSection {...deletion} signingOut={signingOut} /> : null}
    </View>
  );
}
