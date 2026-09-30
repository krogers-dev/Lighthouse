import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';

import { getRuntime } from '@/app-runtime';
import { AddDocumentScreen } from '@/features/documents/AddDocumentScreen';
import { AuthorizedScreen } from '@/features/shared/AuthorizedScreen';

export default function AddDocumentRoute(): React.JSX.Element {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  // The request id is a filter inside the selected scope, never scope
  // (threat T5); the screen re-reads the request and decides from
  // server-confirmed facts whether a document may be added at all.
  const raw = params.id;
  const requestId = Array.isArray(raw) ? (raw[0] ?? '') : (raw ?? '');
  const runtime = getRuntime();
  return (
    <AuthorizedScreen current="requests" testID="add-document-screen">
      {runtime.ok ? (
        <AddDocumentScreen
          repository={runtime.services.requestsRepository}
          documentsRepository={runtime.services.documentsRepository}
          ports={runtime.services.documentPorts}
          requestId={requestId}
          onBack={() => router.push(`/requests/${requestId}` as never)}
        />
      ) : null}
    </AuthorizedScreen>
  );
}
