import { useRouter } from 'expo-router';
import React from 'react';

import { useAuthController, useAuthState } from '@/auth/provider';
import { SettingsView } from '@/features/settings/SettingsView';
import { AuthorizedScreen } from '@/features/shared/AuthorizedScreen';

export default function SettingsRoute(): React.JSX.Element {
  const state = useAuthState();
  const controller = useAuthController();
  const router = useRouter();
  const authorized = state.name === 'authorized' ? state : null;
  const workspaceName = authorized
    ? authorized.memberships.find((m) => m.membershipId === authorized.scope.membershipId)
        ?.entityName
    : undefined;
  return (
    // Account is one of the five peer destinations, so it keeps the same
    // shell and the same persistent nav as the others; arriving here used
    // to strip the nav and leave a system back gesture as the only way
    // out, which is neither a persistent label nor discoverable with a
    // screen reader. Back stays as well: the brief asks for a safe
    // back/cancel on every screen, and returning to where you came from
    // is not the same move as jumping to a named destination.
    //
    // `signing_out` stays on this screen so the user watches sign-out
    // complete instead of protected UI flashing back; the shell drops the
    // nav in that state on its own.
    <AuthorizedScreen current="account" testID="settings-screen" alsoAllow={['signing_out']}>
      <SettingsView
        workspaceName={workspaceName}
        canSwitchScope={(authorized?.memberships.length ?? 0) > 1}
        signingOut={state.name === 'signing_out'}
        onSwitchScope={() => void controller.switchScope()}
        onSignOut={() => void controller.signOut()}
        onBack={() => router.back()}
      />
    </AuthorizedScreen>
  );
}
