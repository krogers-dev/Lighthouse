/** The review tenant's sign-in through the shipped composition (WO-008,
 * option A). The bridge lane seeds the tenant and opens a window with a
 * code in the file HIVE_REVIEW_CODE_FILE names; the review identity signs
 * in exactly as a reviewer would (the sign-in email, then the code on the
 * OTP screen, which the server refuses as an OTP and admits as the review
 * code), lands in the review workspace, reads its one case, and signs
 * out. The lane hands the code to this process in memory
 * (HIVE_REVIEW_CODE), closes the window, and retires the tenant
 * afterwards. */
import type { AuthState } from '@/auth/machine';

import { buildApp, waitForState } from './journeys';

const REVIEW_EMAIL = 'review.reader@example.invalid';
const REVIEW_CASE = '77777777-2222-4000-8000-000000000001';

jest.setTimeout(120_000);

describe('live bridge: the review tenant through the shipped composition', () => {
  test('the review identity signs in with the review code and sees only the review workspace', async () => {
    const code = (process.env.HIVE_REVIEW_CODE ?? '').trim();
    expect(code).toMatch(/^[0-9]{12,20}$/);

    const app = buildApp();
    await app.controller.boot();
    await waitForState(app.controller, 'boot', (state) => state.name === 'signed_out');
    await app.controller.startSignIn(REVIEW_EMAIL);
    await waitForState(
      app.controller,
      'code sent',
      (state) => state.name === 'first_factor' && state.otpSent,
    );
    await app.controller.submitOtp(code);
    const landed = (await waitForState(
      app.controller,
      'after the review code',
      (state) => state.name === 'authorized' || state.name === 'select_scope',
    )) as Extract<AuthState, { name: 'authorized' | 'select_scope' }>;
    if (landed.name === 'select_scope') {
      await app.controller.selectScope(landed.memberships[0]!.membershipId);
    }
    const authorized = (await waitForState(
      app.controller,
      'authorized',
      (state) => state.name === 'authorized',
    )) as Extract<AuthState, { name: 'authorized' }>;
    expect(authorized.memberships).toHaveLength(1);
    expect(authorized.memberships[0]!.role).toBe('client_user');

    const home = await app.dashboard.load(authorized.scope);
    expect(home.items.map((entry) => entry.id)).toEqual([REVIEW_CASE]);
    await app.controller.signOut();
    await waitForState(app.controller, 'signed out', (state) => state.name === 'signed_out');
  });
});
