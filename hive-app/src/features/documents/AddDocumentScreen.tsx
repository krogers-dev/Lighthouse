/** Connected add-document screen (WO-003).
 *
 * Loads the request and its documents through the same scoped read the
 * detail screen uses, decides from server-confirmed facts whether a
 * document may be added, and only then mounts the flow, which holds the
 * bytes and drives the three server round trips. */
import React, { useCallback } from 'react';

import { useAuthController } from '@/auth/provider';
import type { RandomSource } from '@/core/ids';
import type { DocumentsLoader, DocumentUploader } from '@/data/supabase/documents';
import type { RequestDetail, RequestsLoader } from '@/data/supabase/repositories';
import {
  type RequestWithDocuments,
  canAddDocumentTo,
  loadRequestWithDocuments,
} from '@/features/requests/RequestDetailScreen';
import { useScopedLoad } from '@/features/shared/useScopedLoad';
import type { ScopeKey } from '@/tenancy/scope-key';

import { AddDocumentView, type AddDocumentViewProps } from './AddDocumentView';
import { initialAddDocumentState } from './add-document-flow';
import type { Digester, DocumentReader, DocumentSource } from './ports';
import { useAddDocument } from './useAddDocument';

export interface AddDocumentPorts {
  source: DocumentSource;
  reader: DocumentReader;
  digester: Digester;
  random: RandomSource;
}

export interface AddDocumentScreenProps {
  repository: RequestsLoader;
  documentsRepository: DocumentsLoader & DocumentUploader;
  ports: AddDocumentPorts;
  requestId: string;
  onBack: () => void;
}

const isMissing = (value: RequestWithDocuments): boolean => value.request === null;

type FlowViewProps = Omit<AddDocumentViewProps, 'flow' | 'onChoose' | 'onSend'>;

/** Mounted only once the request is known and a document may be added,
 * so the flow's hooks are called unconditionally within it. */
function AddDocumentFlow({
  scope,
  request,
  uploader,
  ports,
  view,
}: {
  scope: ScopeKey;
  request: RequestDetail;
  uploader: DocumentUploader;
  ports: AddDocumentPorts;
  view: FlowViewProps;
}): React.JSX.Element {
  const controller = useAuthController();
  const onSessionExpired = useCallback(() => void controller.sessionExpired(), [controller]);
  const flow = useAddDocument({
    scope,
    request: { id: request.id, version: request.version },
    uploader,
    source: ports.source,
    reader: ports.reader,
    digester: ports.digester,
    random: ports.random,
    onSessionExpired,
  });
  return <AddDocumentView {...view} flow={flow.state} onChoose={flow.choose} onSend={flow.send} />;
}

export function AddDocumentScreen({
  repository,
  documentsRepository,
  ports,
  requestId,
  onBack,
}: AddDocumentScreenProps): React.JSX.Element | null {
  const load = useCallback(
    (scope: ScopeKey) =>
      loadRequestWithDocuments(repository, documentsRepository, requestId)(scope),
    [repository, documentsRepository, requestId],
  );
  const { scope, state, data, error, role, retry, switchScope } = useScopedLoad(load, isMissing);

  if (!scope) return null;

  const request = data?.request ?? null;
  const canAdd = canAddDocumentTo(role, request, data?.documents ?? null);
  const view: FlowViewProps = {
    state,
    request,
    canAdd,
    error,
    onRetry: retry,
    onSwitchScope: switchScope,
    onBack,
  };

  if (state === 'ready' && request && canAdd) {
    return (
      <AddDocumentFlow
        scope={scope}
        request={request}
        uploader={documentsRepository}
        ports={ports}
        view={view}
      />
    );
  }

  const noop = (): void => {};
  return <AddDocumentView {...view} flow={initialAddDocumentState} onChoose={noop} onSend={noop} />;
}
