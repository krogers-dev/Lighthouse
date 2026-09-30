/** Route guard: every screen declares which auth states may render it;
 * anything else redirects to that state's home route. Deep links can steer
 * navigation but can never place a user in a state's screen without the
 * state — and no route reads scope from params. */
import { Redirect } from 'expo-router';
import React from 'react';

import type { AuthState, AuthStateName } from './machine';

export const ROUTE_FOR_STATE: Record<AuthStateName, string> = {
  booting: '/',
  signed_out: '/sign-in',
  first_factor: '/otp',
  mfa_required: '/mfa',
  select_scope: '/select-scope',
  authorized: '/dashboard',
  signing_out: '/',
  storage_quarantined: '/quarantine',
  fatal: '/fatal',
};

export function guardRedirect(
  state: AuthState,
  ...allowed: AuthStateName[]
): React.JSX.Element | null {
  if (allowed.includes(state.name)) return null;
  // Redirect's typed-route generic is generated at build time; the map above
  // only contains routes that exist in app/.
  return <Redirect href={ROUTE_FOR_STATE[state.name] as never} />;
}
