/** Find 38: a refresh must re-ask the server who the actor is, and a
 * membership revoked underneath the bound scope must render as stale
 * scope — never as an empty list RLS quietly filtered. */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import { Text } from 'react-native';

import type { AuthState } from '@/auth/machine';

import { useScopedLoad } from '../useScopedLoad';

const refreshMemberships = jest.fn(() => Promise.resolve());
const mockController = { refreshMemberships, switchScope: jest.fn(), sessionExpired: jest.fn() };
let mockState: AuthState;
jest.mock('@/auth/provider', () => ({
  useAuthState: () => mockState,
  useAuthController: () => mockController,
}));

const scope = {
  membershipId: 'm-1',
  environmentId: 'env-1',
  clientId: 'client-1',
  entityId: 'entity-1',
  role: 'client_user',
};
const authorizedWith = (memberships: unknown[]): AuthState =>
  ({
    name: 'authorized',
    actor: { userId: 'u-1', aal: 'aal1' },
    scope,
    memberships,
  }) as unknown as AuthState;

function Probe(): React.JSX.Element {
  const load = React.useCallback(async () => ['row'], []);
  const result = useScopedLoad(load, (v: string[]) => v.length === 0);
  return (
    <>
      <Text testID="state">{result.state}</Text>
      <Text testID="retry" onPress={result.retry}>
        retry
      </Text>
    </>
  );
}

describe('useScopedLoad (find 38)', () => {
  beforeEach(() => {
    refreshMemberships.mockClear();
    mockState = authorizedWith([{ membershipId: 'm-1' }]);
  });

  it('a retry re-validates memberships with the server, not only the read', async () => {
    await render(<Probe />);
    expect(await screen.findByText('ready')).toBeTruthy();
    expect(refreshMemberships).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.press(screen.getByTestId('retry'));
    });
    expect(refreshMemberships).toHaveBeenCalledTimes(1);
  });

  it('renders stale scope once the bound membership is gone from the refreshed list', async () => {
    const view = await render(<Probe />);
    expect(await screen.findByText('ready')).toBeTruthy();
    mockState = authorizedWith([{ membershipId: 'm-2' }]);
    await view.rerender(<Probe />);
    expect(screen.getByText('stale_scope')).toBeTruthy();
  });
});
