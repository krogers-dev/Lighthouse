/** Chrome shared by every authorized destination: the route guard result,
 * the scrollable Screen, and the five-destination nav.
 *
 * Routes stay thin (one screen component plus this wrapper) and the nav
 * cannot drift between destinations, because there is exactly one copy of
 * it. */
import { useRouter } from 'expo-router';
import React from 'react';

import { useAuthState } from '@/auth/provider';
import { guardRedirect } from '@/auth/route-guard';
import { PrimaryNav, type NavDestination } from '@/features/shared/PrimaryNav';
import { Screen } from '@/ui';

const ROUTE_FOR: Record<NavDestination, string> = {
  home: '/dashboard',
  requests: '/requests',
  activity: '/activity',
  help: '/help',
  account: '/settings',
};

export interface AuthorizedScreenProps {
  current: NavDestination;
  testID: string;
  children: React.ReactNode;
}

export function AuthorizedScreen({
  current,
  testID,
  children,
}: AuthorizedScreenProps): React.JSX.Element {
  const state = useAuthState();
  const router = useRouter();
  const redirect = guardRedirect(state, 'authorized');
  if (redirect) return redirect;
  return (
    <Screen testID={testID}>
      {children}
      <PrimaryNav
        current={current}
        onNavigate={(destination) => {
          if (destination === current) return;
          router.push(ROUTE_FOR[destination] as never);
        }}
      />
    </Screen>
  );
}
