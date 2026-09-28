/** Add a document to a request (WO-003).
 *
 * One primary action at a time, and every state explicit: choose a file;
 * the file checked on this phone (name, type, size); send it; received.
 * A refusal says why and what to do; a failure keeps the checked file on
 * screen so it can be sent again. Nothing here says approved, filed, or
 * final: a received document is "being checked", and Honeybee's check is
 * the next thing that happens to it.
 *
 * The screen renders only for a client user on an open request with room
 * for another document; the route can be reached in any other case (a
 * deep link, a request that closed meanwhile), and then the screen says
 * so and offers the way back rather than a control that would be refused. */
import React from 'react';
import { StyleSheet, View } from 'react-native';

import type { SafeError } from '@/core/errors';
import type { RequestDetail } from '@/data/supabase/repositories';
import { DOCUMENT_REFUSAL_WORDING, REQUEST_STATUS_PRESENTATION } from '@/features/shared/labels';
import { ScopedStates } from '@/features/shared/ScopedStates';
import type { ScopedLoadStateName } from '@/features/shared/useScopedLoad';
import { AppText, Button, LoadingState, Notice, StatusBadge, useThemeColors } from '@/ui';
import { layout, radii, spacing } from '@/ui/tokens';

import { type AddDocumentState, canChoose, canSend, isBusy } from './add-document-flow';
import { type CheckedDocument, DOCUMENT_LIMITS, formatByteSize } from './document-rules';

export interface AddDocumentViewProps {
  /** The request load: this screen needs the request's version and status
   * before it can act, so it carries the same states as every read. */
  state: ScopedLoadStateName;
  request?: RequestDetail | null;
  /** Decided by the screen from server-confirmed facts (role, status,
   * cap). When false the screen explains and offers the way back. */
  canAdd: boolean;
  flow: AddDocumentState;
  error?: SafeError;
  onRetry: () => void;
  onSwitchScope?: () => void;
  onChoose: () => void;
  onSend: () => void;
  onBack: () => void;
}

const TYPE_LABEL: Record<CheckedDocument['mimeType'], string> = {
  'application/pdf': 'PDF',
  'image/png': 'PNG image',
  'image/jpeg': 'JPEG image',
  'text/csv': 'CSV',
};

const SENDING_LABEL = {
  reserving: 'Reserving a place for it',
  transferring: 'Transferring to Honeybee',
  confirming: 'Confirming it arrived',
} as const;

const styles = StyleSheet.create({
  container: { gap: spacing.lg },
  heading: { gap: spacing.xs },
  context: {
    gap: spacing.sm,
    paddingTop: spacing.md,
    borderTopWidth: layout.hairline,
  },
  panel: {
    borderRadius: radii.lg,
    padding: spacing.md,
    gap: spacing.xs,
  },
  actions: { gap: spacing.md },
});

function DocumentPanel({
  document,
  caption,
  testID,
}: {
  document: CheckedDocument;
  caption: string;
  testID: string;
}): React.JSX.Element {
  const colors = useThemeColors();
  return (
    <View
      style={[styles.panel, { backgroundColor: colors.panelInfoBackground }]}
      testID={testID}
      accessible
      accessibilityLabel={`${document.displayName}. ${TYPE_LABEL[document.mimeType]}, ${formatByteSize(document.byteSize)}. ${caption}`}
    >
      <AppText variant="bodyStrong" style={{ color: colors.panelInfoText }}>
        {document.displayName}
      </AppText>
      <AppText variant="caption" style={{ color: colors.panelInfoText }}>
        {`${TYPE_LABEL[document.mimeType]} · ${formatByteSize(document.byteSize)}`}
      </AppText>
      <AppText variant="caption" style={{ color: colors.panelInfoText }}>
        {caption}
      </AppText>
    </View>
  );
}

export function AddDocumentView({
  state,
  request,
  canAdd,
  flow,
  error,
  onRetry,
  onSwitchScope,
  onChoose,
  onSend,
  onBack,
}: AddDocumentViewProps): React.JSX.Element {
  const colors = useThemeColors();
  const presentation = request ? REQUEST_STATUS_PRESENTATION[request.status] : null;
  const busy = isBusy(flow);
  return (
    <View style={styles.container} testID="add-document">
      <View style={styles.heading}>
        <AppText variant="title" accessibilityRole="header">
          Add a document
        </AppText>
        <AppText variant="caption" tone="secondary">
          {`PDF, PNG, JPEG or CSV, up to ${Math.round(DOCUMENT_LIMITS.maxBytes / (1024 * 1024))} MB. Up to ${DOCUMENT_LIMITS.maxPerRequest} documents per request.`}
        </AppText>
      </View>

      <ScopedStates
        state={state}
        testIDPrefix="add-document"
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
          testID="add-document-empty"
        />
      ) : null}

      {state === 'ready' && request && presentation ? (
        <View style={[styles.context, { borderTopColor: colors.divider }]}>
          <AppText variant="caption" tone="secondary">
            For this request
          </AppText>
          <AppText variant="heading" testID="add-document-request-title">
            {request.title}
          </AppText>
          <StatusBadge kind={presentation.kind} label={presentation.label} />
        </View>
      ) : null}

      {state === 'ready' && request && !canAdd ? (
        <Notice
          tone="info"
          title="This request is not taking documents right now"
          body="It may have been answered or closed, or it already holds all the documents it can take. Go back to the request to see its current status."
          testID="add-document-unavailable"
        />
      ) : null}

      {state === 'ready' && request && canAdd ? (
        <View style={styles.actions}>
          {flow.name === 'picking' ? (
            <LoadingState label="Opening your files" testID="add-document-picking" />
          ) : null}
          {flow.name === 'checking' ? (
            <LoadingState label="Checking the file on this phone" testID="add-document-checking" />
          ) : null}
          {flow.name === 'sending' ? (
            <LoadingState label={SENDING_LABEL[flow.step]} testID="add-document-sending" />
          ) : null}

          {flow.name === 'checked' ? (
            <DocumentPanel
              document={flow.document}
              caption="Checked on this phone. Nothing has been sent yet."
              testID="add-document-checked"
            />
          ) : null}

          {flow.name === 'received' ? (
            <>
              <Notice
                tone="success"
                title="Received"
                body="Honeybee will check it. On the request it shows as received, being checked."
                testID="add-document-received"
              />
              <DocumentPanel
                document={flow.document}
                caption="Received by Honeybee."
                testID="add-document-received-document"
              />
            </>
          ) : null}

          {flow.name === 'refused' ? (
            <>
              <Notice
                tone="warning"
                title={DOCUMENT_REFUSAL_WORDING[flow.refusal].title}
                body={DOCUMENT_REFUSAL_WORDING[flow.refusal].body}
                testID="add-document-refused"
              />
              {flow.document ? (
                <DocumentPanel
                  document={flow.document}
                  caption="Not sent."
                  testID="add-document-refused-document"
                />
              ) : null}
            </>
          ) : null}

          {flow.name === 'failed' ? (
            <>
              <Notice
                tone="danger"
                title="The document was not sent"
                body={flow.error.userMessage}
                testID="add-document-failed"
              />
              {flow.document ? (
                <DocumentPanel
                  document={flow.document}
                  caption="Still on this phone, ready to send again."
                  testID="add-document-failed-document"
                />
              ) : null}
            </>
          ) : null}

          {canSend(flow) ? (
            <Button
              label={flow.name === 'failed' ? 'Send again' : 'Send to Honeybee'}
              onPress={onSend}
              accessibilityHint="Transfers the checked file into Honeybee's quarantine for checking"
              testID="add-document-send"
            />
          ) : null}
          {canChoose(flow) ? (
            <Button
              kind={flow.name === 'idle' ? 'primary' : 'secondary'}
              label={flow.name === 'idle' ? 'Choose a file' : 'Choose a different file'}
              onPress={onChoose}
              accessibilityHint="Opens your files to pick one document"
              testID="add-document-choose"
            />
          ) : null}
        </View>
      ) : null}

      {/* Safe back at every moment except mid-transfer, when leaving would
          abandon a reservation the server must then expire. */}
      {!busy ? (
        <Button
          kind="secondary"
          label="Back to the request"
          onPress={onBack}
          testID="add-document-back"
        />
      ) : null}
    </View>
  );
}
