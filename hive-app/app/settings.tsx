import { useRouter } from 'expo-router';
import React from 'react';

import { useAuthController, useAuthState } from '@/auth/provider';
import { guardRedirect } from '@/auth/route-guard';
import { SettingsView } from '@/features/settings/SettingsView';
import { Screen } from '@/ui';

export default function SettingsRoute(): React.JSX.Element {
  const state = useAuthState();
  const controller = useAuthController();
  const router = useRouter();
  // signing_out stays here so the user watches the sign-out complete
  // instead of protected UI flashing back.
  const redirect = guardRedirect(state, 'authorized', 'signing_out');
  if (redirect) return redirect;
  const authorized = state.name === 'authorized' ? state : null;
  const workspaceName = authorized
    ? authorized.memberships.find((m) => m.membershipId === authorized.scope.membershipId)
        ?.entityName
    : undefined;
  return (
    <Screen testID="settings-screen">
      <SettingsView
        workspaceName={workspaceName}
        canSwitchScope={(authorized?.memberships.length ?? 0) > 1}
        signingOut={state.name === 'signing_out'}
        onSwitchScope={() => void controller.switchScope()}
        onSignOut={() => void controller.signOut()}
        onBack={() => router.back()}
      />
    </Screen>
  );
}
