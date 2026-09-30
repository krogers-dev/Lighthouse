/** Connected screen for opening a case (WO-013). Binds the authorized
 * scope, decides from the server-confirmed role whether the viewer may
 * open a case here, and drives the creation flow keyed on the scope, so
 * a scope switch starts a fresh draft. */
import React, { useCallback } from 'react';

import { useAuthController } from '@/auth/provider';
import type { RandomSource } from '@/core/ids';
import type { IntakeWriter, OpenedCase } from '@/data/supabase/reviews';
import { useScopedLoad } from '@/features/shared/useScopedLoad';
import type { ScopeKey } from '@/tenancy/scope-key';
import { scopeKeyToken } from '@/tenancy/scope-key';

import {
  type CaseDraft,
  canOpenCase,
  checkTitle,
  initialCaseDraft,
  sanitizeTitle,
} from './intake-rules';
import { NewCaseView } from './NewCaseView';
import { useCreation } from './useCreation';

export interface NewCaseScreenProps {
  writer: IntakeWriter;
  random?: RandomSource;
  onOpened: (caseId: string) => void;
  onBack: () => void;
}

function NewCaseFlow({
  scope,
  workspaceName,
  writer,
  random,
  onOpened,
  onBack,
  onRetry,
  onSwitchScope,
}: {
  scope: ScopeKey;
  workspaceName: string;
  writer: IntakeWriter;
  random: RandomSource | undefined;
  onOpened: (caseId: string) => void;
  onBack: () => void;
  onRetry: () => void;
  onSwitchScope: () => void;
}): React.JSX.Element {
  const controller = useAuthController();
  const onSessionExpired = useCallback(() => void controller.sessionExpired(), [controller]);
  const check = useCallback((draft: CaseDraft) => {
    const title = checkTitle(draft.title);
    return title.ok ? null : title.refusal;
  }, []);
  const create = useCallback(
    (draft: CaseDraft, idempotencyKey: string): Promise<OpenedCase> => {
      const title = checkTitle(draft.title);
      return writer.openCase(scope, {
        title: title.ok ? title.title : draft.title,
        idempotencyKey,
      });
    },
    [scope, writer],
  );
  const flow = useCreation<CaseDraft, OpenedCase>({
    initialDraft: initialCaseDraft,
    check,
    create,
    ...(random ? { random } : {}),
    onSessionExpired,
  });
  return (
    <NewCaseView
      state="ready"
      workspaceName={workspaceName}
      allowed
      flow={flow.state}
      onRetry={onRetry}
      onSwitchScope={onSwitchScope}
      onChangeTitle={(title) => flow.setDraft({ title: sanitizeTitle(title) })}
      onRequest={flow.request}
      onConfirm={flow.confirm}
      onCancel={flow.cancel}
      onDismiss={flow.dismiss}
      onTryAgain={flow.retry}
      onOpened={onOpened}
      onBack={onBack}
    />
  );
}

const nothingToLoad = async (): Promise<Record<string, never>> => ({});
const neverEmpty = (): boolean => false;

export function NewCaseScreen({
  writer,
  random,
  onOpened,
  onBack,
}: NewCaseScreenProps): React.JSX.Element | null {
  const { scope, state, error, workspaceName, role, retry, switchScope } = useScopedLoad(
    nothingToLoad,
    neverEmpty,
  );
  if (!scope) return null;
  const allowed = canOpenCase(role);
  if (state === 'ready' && allowed) {
    return (
      <NewCaseFlow
        key={scopeKeyToken(scope)}
        scope={scope}
        workspaceName={workspaceName}
        writer={writer}
        random={random}
        onOpened={onOpened}
        onBack={onBack}
        onRetry={retry}
        onSwitchScope={switchScope}
      />
    );
  }
  const noop = (): void => {};
  return (
    <NewCaseView
      state={state}
      workspaceName={workspaceName}
      allowed={allowed}
      flow={{ name: 'idle', draft: initialCaseDraft }}
      error={error}
      onRetry={retry}
      onSwitchScope={switchScope}
      onChangeTitle={noop}
      onRequest={noop}
      onConfirm={noop}
      onCancel={noop}
      onDismiss={noop}
      onTryAgain={noop}
      onOpened={onOpened}
      onBack={onBack}
    />
  );
}
