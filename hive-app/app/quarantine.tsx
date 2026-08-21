import React from 'react';

import { useAuthController, useAuthState } from '@/auth/provider';
import { guardRedirect } from '@/auth/route-guard';
import { QuarantineState, Screen } from '@/ui';

export default function QuarantineRoute(): React.JSX.Element {
  const state = useAuthState();
  const controller = useAuthController();
  const redirect = guardRedirect(state, 'storage_quarantined');
  if (redirect) return redirect;
  const quarantined = state.name === 'storage_quarantined' ? state : null;
  return (
    <Screen testID="quarantine-screen">
      <QuarantineState
        scrubInProgress={quarantined?.scrubInProgress ?? false}
        lastAttemptFailed={quarantined?.lastAttemptFailed ?? false}
        onScrub={() => void controller.scrubQuarantine()}
      />
    </Screen>
  );
}
