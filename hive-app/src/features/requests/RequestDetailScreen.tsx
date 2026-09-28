/** Connected request detail, with the request's documents (WO-003).
 *
 * The id comes from the route and is passed to the repositories as a
 * FILTER, never as scope: every query still carries the selected scope
 * triple and RLS filters ahead of it, so a foreign id yields no row and
 * the screen shows "not found here" (threat T5).
 *
 * Whether "Add a document" exists is decided here, from server-confirmed
 * facts only: the role of the membership the scope was bound from, the
 * request's status, and how many live documents it already carries. */
import React, { useCallback } from 'react';

import type { DocumentSummary, DocumentsLoader } from '@/data/supabase/documents';
import type { RequestDetail, RequestsLoader, ScopedList } from '@/data/supabase/repositories';
import { canAddAnotherDocument } from '@/features/documents/document-rules';
import { useScopedLoad } from '@/features/shared/useScopedLoad';
import type { ScopeKey } from '@/tenancy/scope-key';
import type { MembershipRole } from '@/tenancy/types';

import { RequestDetailView } from './RequestDetailView';

export interface RequestWithDocuments {
  request: RequestDetail | null;
  documents: ScopedList<DocumentSummary> | null;
}

export interface RequestDetailScreenProps {
  repository: RequestsLoader;
  documentsRepository: DocumentsLoader;
  requestId: string;
  onAddDocument: () => void;
  onBack: () => void;
}

const isMissing = (value: RequestWithDocuments): boolean => value.request === null;

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

/** The one rule for the one write control (WO-003 R4). */
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

export function RequestDetailScreen({
  repository,
  documentsRepository,
  requestId,
  onAddDocument,
  onBack,
}: RequestDetailScreenProps): React.JSX.Element | null {
  const load = useCallback(
    (scope: ScopeKey) =>
      loadRequestWithDocuments(repository, documentsRepository, requestId)(scope),
    [repository, documentsRepository, requestId],
  );
  const { scope, state, data, error, role, retry, switchScope } = useScopedLoad(load, isMissing);

  if (!scope) return null;

  return (
    <RequestDetailView
      state={state}
      request={data?.request}
      documents={data?.documents ?? undefined}
      canAddDocument={canAddDocumentTo(role, data?.request ?? null, data?.documents ?? null)}
      error={error}
      onRetry={retry}
      onSwitchScope={switchScope}
      onAddDocument={onAddDocument}
      onBack={onBack}
    />
  );
}
