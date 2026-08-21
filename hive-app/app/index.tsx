import { Redirect } from 'expo-router';
import React from 'react';

import { useAuthState } from '@/auth/provider';
import { ROUTE_FOR_STATE } from '@/auth/route-guard';
import { LoadingState, Screen } from '@/ui';

export default function IndexRoute(): React.JSX.Element {
  const state = useAuthState();
  if (state.name === 'booting' || state.name === 'signing_out') {
    return (
      <Screen testID="boot-screen">
        <LoadingState label={state.name === 'booting' ? 'Starting HIVE' : 'Signing out'} />
      </Screen>
    );
  }
  return <Redirect href={ROUTE_FOR_STATE[state.name] as never} />;
}
