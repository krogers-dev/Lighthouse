/** The account-deletion request through the shipped composition (WO-007).
 *
 * client.owner signs in exactly as the screen drives it, reads no request,
 * asks for deletion with a phone-made key, reads the open request back,
 * meets the refusal on a second ask, withdraws, reads the withdrawal, and
 * signs out. The kill switch is the server role's and is proven by the
 * harness and pgTAP; the app only ever reads its status. Runs only through
 * the bridge lanes; on the CLI stack the lane withdraws any open request
 * of the person first and resumes the service. */
import type { AuthState } from '@/auth/machine';
import { AccountRefusedError } from '@/data/supabase/account';
import { readServiceStatus } from '@/core/service-status';

import { buildApp, signInWithOtp, waitForState } from './journeys';

function uuidV4(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

jest.setTimeout(120_000);

describe('live bridge: release controls through the shipped composition', () => {
  test('the public status reads open with nothing identifying anyone', async () => {
    const status = await readServiceStatus({
      supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? '',
      supabaseClientKey: process.env.EXPO_PUBLIC_SUPABASE_CLIENT_KEY ?? '',
    });
    expect(status).toMatchObject({ state: 'open' });
    expect(status?.minAppVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test('a person asks for deletion, reads it back, cannot ask twice, withdraws, and reads that too', async () => {
    const app = buildApp();
    await app.controller.boot();
    await waitForState(app.controller, 'boot', (state) => state.name === 'signed_out');
    await signInWithOtp(app, 'client.owner@example.invalid');
    const landed = (await waitForState(
      app.controller,
      'after OTP',
      (state) => state.name === 'authorized' || state.name === 'select_scope',
    )) as Extract<AuthState, { name: 'authorized' | 'select_scope' }>;
    if (landed.name === 'select_scope') {
      await app.controller.selectScope(landed.memberships[0]!.membershipId);
    }
    await waitForState(app.controller, 'authorized', (state) => state.name === 'authorized');

    const before = await app.account.getLatestDeletionRequest();
    expect(before?.status ?? 'none').not.toBe('REQUESTED');
    const key = uuidV4();
    const requested = await app.account.requestDeletion(key);
    expect(requested).toMatchObject({ status: 'REQUESTED', replayed: false });
    expect(await app.account.requestDeletion(key)).toMatchObject({
      requestId: requested.requestId,
      replayed: true,
    });
    await expect(app.account.requestDeletion(uuidV4())).rejects.toBeInstanceOf(AccountRefusedError);
    const open = await app.account.getLatestDeletionRequest();
    expect(open).toMatchObject({ id: requested.requestId, status: 'REQUESTED', withdrawnAt: null });
    const withdrawn = await app.account.withdrawDeletion(uuidV4());
    expect(withdrawn).toMatchObject({ requestId: requested.requestId, status: 'WITHDRAWN' });
    const after = await app.account.getLatestDeletionRequest();
    expect(after?.status).toBe('WITHDRAWN');
    expect(after?.withdrawnAt).not.toBeNull();
    await app.controller.signOut();
    await waitForState(app.controller, 'signed out', (state) => state.name === 'signed_out');
  });
});
