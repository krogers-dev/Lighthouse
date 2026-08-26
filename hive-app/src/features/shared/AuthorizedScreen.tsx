/** Chrome shared by every authorized destination: the route guard result,
 * the scrollable Screen, and the five-destination nav.
 *
 * Routes stay thin (one screen component plus this wrapper) and the nav
 * cannot drift between destinations, because there is exactly one copy of
 * it. */
import { useRouter } from 'expo-router';
import React from 'react';

import type { AuthStateName } from '@/auth/machine';
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
  /** States beyond `authorized` that may render this destination. Only
   * Account needs one: it stays on screen while sign-out completes, so
   * the user watches it finish instead of protected UI flashing back. */
  alsoAllow?: readonly AuthStateName[];
  children: React.ReactNode;
}

export function AuthorizedScreen({
  current,
  testID,
  alsoAllow = [],
  children,
}: AuthorizedScreenProps): React.JSX.Element {
  const state = useAuthState();
  const router = useRouter();
  const redirect = guardRedirect(state, 'authorized', ...alsoAllow);
  if (redirect) return redirect;
  return (
    <Screen testID={testID}>
      {children}
      {/* The nav renders only while authorized. During sign-out the
          destinations still exist but must not be reachable: a tap would
          push back into protected UI while the session is being torn
          down. Absent, not disabled — there is nothing to come back to. */}
      {state.name === 'authorized' ? (
        <PrimaryNav
          current={current}
          onNavigate={(destination) => {
            if (destination === current) return;
            router.push(ROUTE_FOR[destination] as never);
          }}
        />
      ) : null}
    </Screen>
  );
}
