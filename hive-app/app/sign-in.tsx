import React from 'react';

import { useAuthController, useAuthState } from '@/auth/provider';
import { guardRedirect } from '@/auth/route-guard';
import { SignInView } from '@/auth/views/SignInView';
import { Screen } from '@/ui';

export default function SignInRoute(): React.JSX.Element {
  const state = useAuthState();
  const controller = useAuthController();
  const redirect = guardRedirect(state, 'signed_out');
  if (redirect) return redirect;
  const signedOut = state.name === 'signed_out' ? state : null;
  const reason = signedOut?.reason;
  return (
    <Screen testID="sign-in-screen">
      <SignInView
        busy={false}
        signedOutReason={
          reason === 'expired' ||
          reason === 'scrubbed' ||
          reason === 'no_access' ||
          reason === 'offline'
            ? reason
            : undefined
        }
        onSubmitEmail={(email) => void controller.startSignIn(email)}
      />
    </Screen>
  );
}
