import { useRouter } from 'expo-router';
import React, { useCallback } from 'react';

import { getRuntime } from '@/app-runtime';
import { useAuthController, useAuthState } from '@/auth/provider';
import { SettingsView } from '@/features/settings/SettingsView';
import { useDeletionRequest } from '@/features/settings/useDeletionRequest';
import { AuthorizedScreen } from '@/features/shared/AuthorizedScreen';

export default function SettingsRoute(): React.JSX.Element {
  const state = useAuthState();
  const controller = useAuthController();
  const router = useRouter();
  const runtime = getRuntime();
  const authorized = state.name === 'authorized' ? state : null;
  const workspaceName = authorized
    ? authorized.memberships.find((m) => m.membershipId === authorized.scope.membershipId)
        ?.entityName
    : undefined;
  // The deletion control exists only with the public deletion page (WO-007)
  // and only while authorized; the hook stays mounted either way so the
  // rules of hooks hold, and does nothing when disabled.
  const deletionInfoUrl = runtime.ok ? runtime.services.env.deletionInfoUrl : undefined;
  const onSessionExpired = useCallback(() => void controller.sessionExpired(), [controller]);
  const deletion = useDeletionRequest({
    account: runtime.ok
      ? runtime.services.accountRepository
      : {
          getLatestDeletionRequest: () => Promise.resolve(null),
          requestDeletion: () => Promise.reject(new Error('not configured')),
          withdrawDeletion: () => Promise.reject(new Error('not configured')),
        },
    enabled: runtime.ok && authorized !== null && deletionInfoUrl !== undefined,
    ...(runtime.ok ? { random: runtime.services.random } : {}),
    onSessionExpired,
  });
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
        supportEmail={runtime.ok ? runtime.services.env.supportEmail : undefined}
        workspaceName={workspaceName}
        canSwitchScope={(authorized?.memberships.length ?? 0) > 1}
        signingOut={state.name === 'signing_out'}
        {...(deletionInfoUrl && authorized
          ? {
              deletion: {
                infoUrl: deletionInfoUrl,
                load: deletion.load,
                flow: deletion.flow,
                onReload: deletion.reload,
                onRequest: () => deletion.request('request'),
                onWithdraw: () => deletion.request('withdraw'),
                onConfirm: deletion.confirm,
                onCancel: deletion.cancel,
                onDismiss: deletion.dismiss,
                onTryAgain: deletion.retry,
              },
            }
          : {})}
        onSwitchScope={() => void controller.switchScope()}
        onSignOut={() => void controller.signOut()}
        onBack={() => router.back()}
      />
    </AuthorizedScreen>
  );
}
