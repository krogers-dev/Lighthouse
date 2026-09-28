/** Connected request detail, with the request's documents (WO-003) and
 * its answer (WO-004).
 *
 * The id comes from the route and is passed to the repositories as a
 * FILTER, never as scope: every query still carries the selected scope
 * triple and RLS filters ahead of it, so a foreign id yields no row and
 * the screen shows "not found here" (threat T5).
 *
 * Whether "Add a document" and "Answer this request" exist is decided
 * here, from server-confirmed facts only: the role of the membership the
 * scope was bound from, the request's status, how many live documents
 * it already carries, and whether an answer was already submitted. */
import React, { useCallback } from 'react';

import type { AnswerLoader, RequestAnswer } from '@/data/supabase/answers';
import type { DocumentSummary, DocumentsLoader } from '@/data/supabase/documents';
import type { RequestDetail, RequestsLoader, ScopedList } from '@/data/supabase/repositories';
import { canAnswer } from '@/features/answers/answer-rules';
import { canAddAnotherDocument } from '@/features/documents/document-rules';
import { useScopedLoad } from '@/features/shared/useScopedLoad';
import type { ScopeKey } from '@/tenancy/scope-key';
import type { MembershipRole } from '@/tenancy/types';

import { RequestDetailView } from './RequestDetailView';

export interface RequestWithDocuments {
  request: RequestDetail | null;
  documents: ScopedList<DocumentSummary> | null;
}

/** Everything the detail and answer screens show about one request:
 * the request, its documents, its answer (a client's own draft or a
 * submitted answer), and the document it is about, each read inside
 * the scope. */
export interface RequestContext extends RequestWithDocuments {
  answer: RequestAnswer | null;
  subjectDocument: DocumentSummary | null;
}

export interface RequestDetailScreenProps {
  repository: RequestsLoader;
  documentsRepository: DocumentsLoader;
  answersRepository: AnswerLoader;
  requestId: string;
  onAddDocument: () => void;
  onAnswer: () => void;
  onBack: () => void;
}

const isMissing = (value: RequestContext): boolean => value.request === null;

/** Documents that occupy a place under the per-request cap: received or
 * checked, never one that was refused or expired. */
export function liveDocumentCount(documents: ScopedList<DocumentSummary> | null): number {
  if (!documents) return 0;
  return documents.items.filter(
    (document) =>
      document.status === 'QUARANTINED' ||
      document.status === 'VALIDATING' ||
      document.status === 'ACCEPTED',
  ).length;
}

/** The one rule for the document write control (WO-003 R4). */
export function canAddDocumentTo(
  role: MembershipRole | null,
  request: RequestDetail | null,
  documents: ScopedList<DocumentSummary> | null,
): boolean {
  return (
    role === 'client_user' &&
    request !== null &&
    request.status === 'OPEN' &&
    canAddAnotherDocument(liveDocumentCount(documents))
  );
}

/** The request and its documents in one scoped read, so the screen has
 * one state and one recorded-through line. Shared with the add-document
 * screen, which needs exactly the same facts. */
export function loadRequestWithDocuments(
  repository: RequestsLoader,
  documentsRepository: DocumentsLoader,
  requestId: string,
): (scope: ScopeKey) => Promise<RequestWithDocuments> {
  return async (scope: ScopeKey) => {
    const request = await repository.get(scope, requestId);
    if (!request) return { request: null, documents: null };
    const documents = await documentsRepository.list(scope, requestId);
    return { request, documents };
  };
}

/** The full context (WO-004): the request, its documents, its answer,
 * and the document it is about. The source link is an id inside the
 * scope and is resolved by its own scoped read, so a link that pointed
 * outside the workspace could never render a name (threat T5). Shared
 * with the answer screen. */
export function loadRequestContext(
  repository: RequestsLoader,
  documentsRepository: DocumentsLoader,
  answersRepository: AnswerLoader,
  requestId: string,
): (scope: ScopeKey) => Promise<RequestContext> {
  return async (scope: ScopeKey) => {
    const request = await repository.get(scope, requestId);
    if (!request) return { request: null, documents: null, answer: null, subjectDocument: null };
    const documents = await documentsRepository.list(scope, requestId);
    const answer = await answersRepository.get(scope, requestId);
    const subjectDocument = request.subjectDocumentId
      ? await documentsRepository.getById(scope, request.subjectDocumentId)
      : null;
    return { request, documents, answer, subjectDocument };
  };
}

export function RequestDetailScreen({
  repository,
  documentsRepository,
  answersRepository,
  requestId,
  onAddDocument,
  onAnswer,
  onBack,
}: RequestDetailScreenProps): React.JSX.Element | null {
  const load = useCallback(
    (scope: ScopeKey) =>
      loadRequestContext(repository, documentsRepository, answersRepository, requestId)(scope),
    [repository, documentsRepository, answersRepository, requestId],
  );
  const { scope, state, data, error, role, retry, switchScope } = useScopedLoad(load, isMissing);

  if (!scope) return null;

  const request = data?.request ?? null;
  return (
    <RequestDetailView
      state={state}
      request={data?.request}
      documents={data?.documents ?? undefined}
      answer={data?.answer ?? null}
      subjectDocument={data?.subjectDocument ?? null}
      viewerRole={role}
      canAddDocument={canAddDocumentTo(role, request, data?.documents ?? null)}
      canAnswer={canAnswer(role, request, data?.answer ?? null)}
      error={error}
      onRetry={retry}
      onSwitchScope={switchScope}
      onAddDocument={onAddDocument}
      onAnswer={onAnswer}
      onBack={onBack}
    />
  );
}
