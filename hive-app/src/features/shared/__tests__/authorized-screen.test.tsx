/** The authorized shell: who may render, and when the nav is present.
 *
 * The nav promises five peer destinations. A destination that drops the
 * nav on arrival breaks that promise — the reader is stranded with only
 * a system back gesture, which is not a persistent label and is not
 * discoverable with a screen reader. So nav presence is a property of
 * the shell, tested here rather than left to each route to remember.
 */
import { render, screen } from '@testing-library/react-native';
import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import type { AuthState } from '@/auth/machine';
import { AppText } from '@/ui';

import { AuthorizedScreen } from '../AuthorizedScreen';

/** app/_layout.tsx wraps every route in a SafeAreaProvider; the shell
 * reads insets through it, so a render without one is not the real tree. */
const INSETS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

function renderShell(ui: React.JSX.Element) {
  return render(<SafeAreaProvider initialMetrics={INSETS}>{ui}</SafeAreaProvider>);
}

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn() }),
  Redirect: ({ href }: { href: string }) => {
    const { Text } = jest.requireActual('react-native');
    return <Text testID="redirect">{href}</Text>;
  },
}));

let mockState: AuthState;
jest.mock('@/auth/provider', () => ({
  useAuthState: () => mockState,
  useAuthController: () => ({}),
}));

const AUTHORIZED = {
  name: 'authorized',
  memberships: [],
  scope: {
    membershipId: 'm-1',
    environmentId: 'env-1',
    clientId: 'client-1',
    entityId: 'entity-1',
    role: 'client_user',
  },
} as unknown as AuthState;

const SIGNING_OUT = { name: 'signing_out' } as unknown as AuthState;
const SIGNED_OUT = { name: 'signed_out' } as unknown as AuthState;

beforeEach(() => {
  mockPush.mockClear();
  mockState = AUTHORIZED;
});

describe('AuthorizedScreen', () => {
  it('renders its children and the five-destination nav when authorized', async () => {
    await renderShell(
      <AuthorizedScreen current="home" testID="shell">
        <AppText>content</AppText>
      </AuthorizedScreen>,
    );
    expect(screen.getByText('content')).toBeTruthy();
    expect(screen.getAllByRole('tab')).toHaveLength(5);
  });

  it('redirects a state that may not render this screen', async () => {
    mockState = SIGNED_OUT;
    await renderShell(
      <AuthorizedScreen current="home" testID="shell">
        <AppText>content</AppText>
      </AuthorizedScreen>,
    );
    expect(screen.getByTestId('redirect')).toHaveTextContent('/sign-in');
    expect(screen.queryByText('content')).toBeNull();
  });

  it('lets a screen opt into an additional state without widening the default', async () => {
    mockState = SIGNING_OUT;
    // Account must stay on screen while sign-out completes, rather than
    // protected UI flashing back; no other destination allows this.
    await renderShell(
      <AuthorizedScreen current="account" testID="shell" alsoAllow={['signing_out']}>
        <AppText>content</AppText>
      </AuthorizedScreen>,
    );
    expect(screen.getByText('content')).toBeTruthy();
  });

  it('drops the nav while signing out, so no tap can push back into protected UI', async () => {
    mockState = SIGNING_OUT;
    await renderShell(
      <AuthorizedScreen current="account" testID="shell" alsoAllow={['signing_out']}>
        <AppText>content</AppText>
      </AuthorizedScreen>,
    );
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
  });
});
