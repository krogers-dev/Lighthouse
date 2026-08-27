/** The REAL SCREENS rendering REAL DATA.
 *
 * app-live-bridge.test.ts proves the composition beneath the UI. This
 * suite mounts the actual screen components — AuthProvider around
 * DashboardScreen, RequestsScreen's view path, RequestDetailScreen —
 * over that same live composition, signs in through the real OTP email,
 * and asserts what a person would SEE: the canonical synthetic cases on
 * Home newest-first, the requests list, and the no-existence-signal
 * "not found here" for a cross-scope id. It is the closest thing to
 * running the app that exists without a device, and the device lane
 * remains the only claim of pixels on glass.
 */
import { act, render, screen, waitFor } from '@testing-library/react-native';

import { AuthProvider } from '@/auth/provider';
import type { AuthState } from '@/auth/machine';
import { DashboardScreen } from '@/features/dashboard/DashboardScreen';
import { RequestDetailScreen } from '@/features/requests/RequestDetailScreen';
import { RequestsScreen } from '@/features/requests/RequestsScreen';

import { buildApp, signInWithOtp, waitForState } from './journeys';

const CLIENT_EMAIL = 'client.owner@example.invalid';
const A1_ENTITY = 'aaaaaaaa-1111-4000-8000-000000000001';
const A1_CASE_NEWER = 'eeeeeeee-0000-4000-8000-0000000000a1';
const A1_CASE_OLDER = 'eeeeeeee-0000-4000-8000-0000000000a2';
const B1_REQUEST = 'ffffffff-0000-4000-8000-0000000000b1';

jest.setTimeout(120_000);

/** One signed-in app for the whole suite: these are three windows onto
 * one authorized session, exactly as one person moving between tabs. */
let app: ReturnType<typeof buildApp>;

beforeAll(async () => {
  app = buildApp();
  // The provider boots the controller when mounted; booting here first
  // keeps the imperative journey and the mounted tree on one instance.
  await app.controller.boot();
  await waitForState(app.controller, 'boot', (state) => state.name === 'signed_out');
  await signInWithOtp(app, CLIENT_EMAIL);
  const chooser = (await waitForState(
    app.controller,
    'chooser',
    (state) => state.name === 'select_scope',
  )) as Extract<AuthState, { name: 'select_scope' }>;
  const a1 = chooser.memberships.find((membership) => membership.entityId === A1_ENTITY);
  if (!a1) throw new Error('canonical A1 membership missing from live chooser');
  await app.controller.selectScope(a1.membershipId);
  await waitForState(app.controller, 'authorized', (state) => state.name === 'authorized');
});

afterAll(async () => {
  await app.controller.signOut();
  await waitForState(app.controller, 'signed out', (state) => state.name === 'signed_out');
});

describe('the real screens over the live composition', () => {
  test('Home renders the canonical cases, newest first, with a server recorded-through line', async () => {
    await render(
      <AuthProvider controller={app.controller}>
        <DashboardScreen repository={app.dashboard} />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('dashboard-list')).toBeTruthy(), {
      timeout: 15_000,
    });

    expect(screen.getByTestId(`dashboard-case-${A1_CASE_NEWER}`)).toBeTruthy();
    expect(screen.getByTestId(`dashboard-case-${A1_CASE_OLDER}`)).toBeTruthy();
    const rendered = JSON.stringify(screen.toJSON());
    expect(rendered.indexOf(A1_CASE_NEWER)).toBeLessThan(rendered.indexOf(A1_CASE_OLDER));
    // Wording travels from the SERVER row to the glass: synthetic-marked.
    expect(rendered).toContain('(Synthetic)');
    expect(screen.getByTestId('dashboard-recorded-through')).toBeTruthy();
    // The workspace line is the server-confirmed membership's name.
    expect(screen.getByTestId('dashboard-workspace')).toHaveTextContent(/Harbor Light/);
  });

  test('Requests renders the open synthetic requests from live PostgREST', async () => {
    await render(
      <AuthProvider controller={app.controller}>
        <RequestsScreen repository={app.requests} onOpenRequest={() => {}} />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('requests-list')).toBeTruthy(), {
      timeout: 15_000,
    });
    const rendered = JSON.stringify(screen.toJSON());
    expect(rendered).toContain('(Synthetic)');
    expect(screen.queryByTestId('requests-error')).toBeNull();
  });

  test("a cross-scope request id renders 'not found here' — no existence signal reaches the glass", async () => {
    await render(
      <AuthProvider controller={app.controller}>
        <RequestDetailScreen repository={app.requests} requestId={B1_REQUEST} onBack={() => {}} />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByText('Request not found here')).toBeTruthy(), {
      timeout: 15_000,
    });
    // Nothing about client B leaks into the tree: not its title, not an
    // error naming the row — the same rendering an id that never existed
    // would produce.
    const rendered = JSON.stringify(screen.toJSON());
    expect(rendered).not.toContain('Cedar Grove');
    expect(screen.queryByTestId('request-detail-error')).toBeNull();
  });

  test('sign-out strands no protected content: the screen renders nothing without a scope', async () => {
    const view = await render(
      <AuthProvider controller={app.controller}>
        <DashboardScreen repository={app.dashboard} />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('dashboard-list')).toBeTruthy(), {
      timeout: 15_000,
    });
    await act(async () => {
      await app.controller.signOut();
      await waitForState(app.controller, 'signed out', (state) => state.name === 'signed_out');
    });
    // Scope gone → useScopedLoad yields no scope → the screen returns
    // null. No stale case rows survive on the glass (threat T4/P2-9).
    await waitFor(() => expect(screen.queryByTestId('dashboard-list')).toBeNull());
    expect(screen.queryByText(/Synthetic/)).toBeNull();
    view.unmount();

    // Re-arm the session for afterAll symmetry: sign back in.
    await signInWithOtp(app, CLIENT_EMAIL);
    const chooser = (await waitForState(
      app.controller,
      're-chooser',
      (state) => state.name === 'select_scope',
    )) as Extract<AuthState, { name: 'select_scope' }>;
    await app.controller.selectScope(chooser.memberships[0]!.membershipId);
    await waitForState(app.controller, 're-authorized', (state) => state.name === 'authorized');
  });
});
