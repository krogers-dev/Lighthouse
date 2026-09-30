import React from 'react';

import { useAuthController, useAuthState } from '@/auth/provider';
import { guardRedirect } from '@/auth/route-guard';
import { ScopeChooserView } from '@/tenancy/views/ScopeChooserView';
import { Screen } from '@/ui';

export default function SelectScopeRoute(): React.JSX.Element {
  const state = useAuthState();
  const controller = useAuthController();
  const redirect = guardRedirect(state, 'select_scope');
  if (redirect) return redirect;
  const selectScope = state.name === 'select_scope' ? state : null;
  return (
    <Screen testID="select-scope-screen">
      <ScopeChooserView
        memberships={selectScope?.memberships ?? []}
        onSelect={(membershipId) => void controller.selectScope(membershipId)}
        onSignOut={() => void controller.signOut()}
      />
    </Screen>
  );
}
