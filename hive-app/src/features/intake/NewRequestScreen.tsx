/** Connected screen for asking the client for something (WO-013). Loads
 * the case and its checked documents through one scoped read, decides
 * from the server-confirmed role and the case status whether the viewer
 * may ask here, and drives the creation flow keyed on the case version,
 * so a case that moved starts a fresh draft against its new state. */
import React, { useCallback } from 'react';

import { useAuthController } from '@/auth/provider';
import type { RandomSource } from '@/core/ids';
import type { DocumentSummary, DocumentsLoader } from '@/data/supabase/documents';
import type {
  CaseRecord,
  IntakeWriter,
  OpenedRequest,
  ReviewLoader,
} from '@/data/supabase/reviews';
import { useScopedLoad } from '@/features/shared/useScopedLoad';
import type { ScopeKey } from '@/tenancy/scope-key';

import {
  type RequestDraft,
  canAskOnCase,
  checkDetail,
  checkTitle,
  initialRequestDraft,
  sanitizeDetail,
  sanitizeTitle,
} from './intake-rules';
import { NewRequestView } from './NewRequestView';
import { useCreation } from './useCreation';

export interface NewRequestContext {
  caseRecord: CaseRecord | null;
  documents: readonly DocumentSummary[];
}

export interface NewRequestScreenProps {
  reviewRepository: ReviewLoader & IntakeWriter;
  documentsRepository: DocumentsLoader;
  random?: RandomSource;
  caseId: string;
  onBack: () => void;
}

const EMPTY: NewRequestContext = { caseRecord: null, documents: [] };
const isMissing = (value: NewRequestContext): boolean => value.caseRecord === null;

/** The case id is a filter inside the scope, never scope (threat T5). */
export function loadNewRequestContext(
  reviewRepository: ReviewLoader,
  documentsRepository: DocumentsLoader,
  caseId: string,
): (scope: ScopeKey) => Promise<NewRequestContext> {
  return async (scope: ScopeKey) => {
    const caseRecord = await reviewRepository.getCase(scope, caseId);
    if (!caseRecord) return EMPTY;
    const documents = await documentsRepository.listByCase(scope, caseId);
    return { caseRecord, documents };
  };
}

function NewRequestFlow({
  scope,
  caseRecord,
  documents,
  writer,
  random,
  onBack,
  onRetry,
  onSwitchScope,
}: {
  scope: ScopeKey;
  caseRecord: CaseRecord;
  documents: readonly DocumentSummary[];
  writer: IntakeWriter;
  random: RandomSource | undefined;
  onBack: () => void;
  onRetry: () => void;
  onSwitchScope: () => void;
}): React.JSX.Element {
  const controller = useAuthController();
  const onSessionExpired = useCallback(() => void controller.sessionExpired(), [controller]);
  const check = useCallback((draft: RequestDraft) => {
    const title = checkTitle(draft.title);
    if (!title.ok) return title.refusal;
    const detail = checkDetail(draft.detail);
    return detail.ok ? null : detail.refusal;
  }, []);
  const create = useCallback(
    (draft: RequestDraft, idempotencyKey: string): Promise<OpenedRequest> => {
      const title = checkTitle(draft.title);
      const detail = checkDetail(draft.detail);
      return writer.openRequest(scope, {
        caseId: caseRecord.id,
        caseVersion: caseRecord.version,
        title: title.ok ? title.title : draft.title,
        detail: detail.ok ? detail.detail : draft.detail,
        dueInDays: draft.dueInDays,
        subjectDocumentId: draft.subjectDocumentId,
        idempotencyKey,
      });
    },
    [caseRecord.id, caseRecord.version, scope, writer],
  );
  const flow = useCreation<RequestDraft, OpenedRequest>({
    initialDraft: initialRequestDraft,
    check,
    create,
    ...(random ? { random } : {}),
    onSessionExpired,
  });
  const draft = flow.state.draft;
  return (
    <NewRequestView
      state="ready"
      caseRecord={caseRecord}
      documents={documents}
      allowed
      flow={flow.state}
      onRetry={onRetry}
      onSwitchScope={onSwitchScope}
      onChangeTitle={(title) => flow.setDraft({ ...draft, title: sanitizeTitle(title) })}
      onChangeDetail={(detail) => flow.setDraft({ ...draft, detail: sanitizeDetail(detail) })}
      onChooseDue={(dueInDays) => flow.setDraft({ ...draft, dueInDays })}
      onChooseDocument={(subjectDocumentId) => flow.setDraft({ ...draft, subjectDocumentId })}
      onRequest={flow.request}
      onConfirm={flow.confirm}
      onCancel={flow.cancel}
      onDismiss={flow.dismiss}
      onTryAgain={flow.retry}
      onBack={onBack}
    />
  );
}

export function NewRequestScreen({
  reviewRepository,
  documentsRepository,
  random,
  caseId,
  onBack,
}: NewRequestScreenProps): React.JSX.Element | null {
  const load = useCallback(
    (scope: ScopeKey) =>
      loadNewRequestContext(reviewRepository, documentsRepository, caseId)(scope),
    [reviewRepository, documentsRepository, caseId],
  );
  const { scope, state, data, error, role, retry, switchScope } = useScopedLoad(load, isMissing);
  if (!scope) return null;
  const caseRecord = data?.caseRecord ?? null;
  const allowed = canAskOnCase(role, caseRecord?.status ?? null);
  if (state === 'ready' && caseRecord && allowed) {
    return (
      <NewRequestFlow
        key={`${caseRecord.id}:${caseRecord.version}`}
        scope={scope}
        caseRecord={caseRecord}
        documents={data?.documents ?? []}
        writer={reviewRepository}
        random={random}
        onBack={onBack}
        onRetry={retry}
        onSwitchScope={switchScope}
      />
    );
  }
  const noop = (): void => {};
  return (
    <NewRequestView
      state={state}
      caseRecord={caseRecord}
      documents={data?.documents ?? []}
      allowed={allowed}
      flow={{ name: 'idle', draft: initialRequestDraft }}
      error={error}
      onRetry={retry}
      onSwitchScope={switchScope}
      onChangeTitle={noop}
      onChangeDetail={noop}
      onChooseDue={noop}
      onChooseDocument={noop}
      onRequest={noop}
      onConfirm={noop}
      onCancel={noop}
      onDismiss={noop}
      onTryAgain={noop}
      onBack={onBack}
    />
  );
}
