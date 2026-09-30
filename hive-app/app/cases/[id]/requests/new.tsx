import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';

import { getRuntime } from '@/app-runtime';
import { NewRequestScreen } from '@/features/intake/NewRequestScreen';
import { AuthorizedScreen } from '@/features/shared/AuthorizedScreen';

/** Asking the client for something (WO-013). Reachable from the case for
 * intake or the preparer; the server decides for real. */
export default function NewRequestRoute(): React.JSX.Element {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  // A route param is untrusted input, never scope (threat T5).
  const raw = params.id;
  const caseId = Array.isArray(raw) ? (raw[0] ?? '') : (raw ?? '');
  const runtime = getRuntime();
  return (
    <AuthorizedScreen current="home" testID="new-request-screen">
      {runtime.ok ? (
        <NewRequestScreen
          reviewRepository={runtime.services.reviewRepository}
          documentsRepository={runtime.services.documentsRepository}
          random={runtime.services.random}
          caseId={caseId}
          onBack={() => router.replace(`/cases/${caseId}` as never)}
        />
      ) : null}
    </AuthorizedScreen>
  );
}
