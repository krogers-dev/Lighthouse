import React from 'react';

import { useAuthController, useAuthState } from '@/auth/provider';
import { guardRedirect } from '@/auth/route-guard';
import { MfaView } from '@/auth/views/MfaView';
import { Screen } from '@/ui';

export default function MfaRoute(): React.JSX.Element {
  const state = useAuthState();
  const controller = useAuthController();
  const redirect = guardRedirect(state, 'mfa_required');
  if (redirect) return redirect;
  const mfa = state.name === 'mfa_required' ? state : null;
  return (
    <Screen testID="mfa-screen">
      <MfaView
        verifying={mfa?.verifying ?? false}
        notice={mfa?.notice}
        enrollment={mfa?.enrollment}
        onSubmitCode={(code) => void controller.submitTotp(code)}
        onRetrySetup={() => void controller.retryMfaSetup()}
        onSignOut={() => void controller.signOut()}
      />
    </Screen>
  );
}
