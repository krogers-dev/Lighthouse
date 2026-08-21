import React from 'react';

import { useAuthController, useAuthState } from '@/auth/provider';
import { guardRedirect } from '@/auth/route-guard';
import { OtpView } from '@/auth/views/OtpView';
import { Screen } from '@/ui';

export default function OtpRoute(): React.JSX.Element {
  const state = useAuthState();
  const controller = useAuthController();
  const redirect = guardRedirect(state, 'first_factor');
  if (redirect) return redirect;
  const firstFactor = state.name === 'first_factor' ? state : null;
  return (
    <Screen testID="otp-screen">
      <OtpView
        email={firstFactor?.email ?? ''}
        otpSent={firstFactor?.otpSent ?? false}
        verifying={firstFactor?.verifying ?? false}
        notice={firstFactor?.notice}
        onSubmitCode={(code) => void controller.submitOtp(code)}
        onResend={() => void controller.requestOtp()}
        onCancel={() => void controller.cancelSignIn()}
      />
    </Screen>
  );
}
