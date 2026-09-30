/** Connected answer screen (WO-004).
 *
 * Loads the request, its documents, its draft, and the document it is
 * about through the same scoped read the detail screen uses, decides from
 * server-confirmed facts whether an answer may be written, and only then
 * mounts the flow, which holds the submission key and drives the two
 * server round trips. */
import React, { useCallback } from 'react';

import { useAuthController } from '@/auth/provider';
import type { RandomSource } from '@/core/ids';
import type { AnswerLoader, AnswerWriter } from '@/data/supabase/answers';
import type { DocumentsLoader } from '@/data/supabase/documents';
import type { RequestsLoader } from '@/data/supabase/repositories';
import { type RequestContext, loadRequestContext } from '@/features/requests/RequestDetailScreen';
import { useScopedLoad } from '@/features/shared/useScopedLoad';
import type { ScopeKey } from '@/tenancy/scope-key';

import { AnswerView, type AnswerViewProps } from './AnswerView';
import { initialAnswerState } from './answer-flow';
import { canAnswer, citableDocuments } from './answer-rules';
import { useAnswer } from './useAnswer';

export interface AnswerScreenProps {
  repository: RequestsLoader;
  documentsRepository: DocumentsLoader;
  answersRepository: AnswerLoader & AnswerWriter;
  /** The device's random source for the submission key (find 14). */
  random?: RandomSource;
  requestId: string;
  onBack: () => void;
}

const isMissing = (value: RequestContext): boolean => value.request === null;

type FlowHandlers =
  | 'onChangeText'
  | 'onToggleCitation'
  | 'onSave'
  | 'onSubmit'
  | 'onConfirm'
  | 'onCancel'
  | 'onDismiss'
  | 'onTryAgain';

type FlowViewProps = Omit<AnswerViewProps, 'flow' | FlowHandlers>;

/** Mounted only once the request is known and an answer may be written,
 * so the flow's hooks are called unconditionally within it. */
function AnswerFlow({
  scope,
  context,
  writer,
  random,
  view,
}: {
  scope: ScopeKey;
  context: RequestContext & { request: NonNullable<RequestContext['request']> };
  writer: AnswerWriter;
  random: RandomSource | undefined;
  view: FlowViewProps;
}): React.JSX.Element {
  const controller = useAuthController();
  const onSessionExpired = useCallback(() => void controller.sessionExpired(), [controller]);
  const flow = useAnswer({
    scope,
    request: { id: context.request.id, version: context.request.version },
    existing: context.answer,
    writer,
    ...(random ? { random } : {}),
    onSessionExpired,
  });
  return (
    <AnswerView
      {...view}
      flow={flow.state}
      onChangeText={flow.setText}
      onToggleCitation={flow.toggleCitation}
      onSave={flow.save}
      onSubmit={flow.requestSubmit}
      onConfirm={flow.confirmSubmit}
      onCancel={flow.cancelSubmit}
      onDismiss={flow.dismiss}
      onTryAgain={flow.retry}
    />
  );
}

export function AnswerScreen({
  repository,
  documentsRepository,
  answersRepository,
  random,
  requestId,
  onBack,
}: AnswerScreenProps): React.JSX.Element | null {
  const load = useCallback(
    (scope: ScopeKey) =>
      loadRequestContext(repository, documentsRepository, answersRepository, requestId)(scope),
    [repository, documentsRepository, answersRepository, requestId],
  );
  const { scope, state, data, error, role, retry, switchScope } = useScopedLoad(load, isMissing);

  if (!scope) return null;

  const request = data?.request ?? null;
  const answer = data?.answer ?? null;
  const allowed = canAnswer(role, request, answer);
  const view: FlowViewProps = {
    state,
    request,
    subjectDocument: data?.subjectDocument ?? null,
    citable: citableDocuments(data?.documents?.items ?? []),
    canAnswer: allowed,
    error,
    onRetry: retry,
    onSwitchScope: switchScope,
    onBack,
  };

  if (state === 'ready' && data && request && allowed) {
    return (
      <AnswerFlow
        scope={scope}
        context={{ ...data, request }}
        writer={answersRepository}
        random={random}
        view={view}
      />
    );
  }

  const noop = (): void => {};
  return (
    <AnswerView
      {...view}
      flow={initialAnswerState(null)}
      onChangeText={noop}
      onToggleCitation={noop}
      onSave={noop}
      onSubmit={noop}
      onConfirm={noop}
      onCancel={noop}
      onDismiss={noop}
      onTryAgain={noop}
    />
  );
}
