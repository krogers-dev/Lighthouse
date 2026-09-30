import { useRouter } from 'expo-router';
import React from 'react';

import { getRuntime } from '@/app-runtime';
import { NewCaseScreen } from '@/features/intake/NewCaseScreen';
import { AuthorizedScreen } from '@/features/shared/AuthorizedScreen';

/** Opening a case (WO-013). Reachable from Home for an intake membership;
 * anyone else who lands here is told the page is for intake, and the
 * server refuses them the creation regardless of what the route says. */
export default function NewCaseRoute(): React.JSX.Element {
  const router = useRouter();
  const runtime = getRuntime();
  return (
    <AuthorizedScreen current="home" testID="new-case-screen">
      {runtime.ok ? (
        <NewCaseScreen
          writer={runtime.services.reviewRepository}
          random={runtime.services.random}
          onOpened={(caseId) => router.replace(`/cases/${caseId}` as never)}
          onBack={() => router.push('/dashboard' as never)}
        />
      ) : null}
    </AuthorizedScreen>
  );
}
