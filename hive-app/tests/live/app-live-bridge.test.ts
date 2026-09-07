/** The live bridge: the APP'S OWN CODE against the real local stack.
 *
 * Every other lane proves a layer in isolation — jest proves the client
 * logic against fakes, pgTAP proves the policies via SQL impersonation,
 * the black-box harness proves the SERVER over HTTP. What none of them
 * prove is the seam: that the real AuthController, the real supabase-js
 * bundle, and the real scoped repositories — the exact composition
 * src/app-runtime.ts ships — work against the real GoTrue, PostgREST,
 * and this repository's actual RLS.
 *
 * This suite constructs that composition verbatim, swapping ONLY the two
 * native backends (Keychain, document directory) for named synthetic
 * in-memory ones, and drives real journeys: client OTP sign-in with the
 * code read from a real Mailpit email, workspace choice, the three read
 * repositories returning the canonical synthetic rows, cross-scope
 * denial with no existence signal, staff TOTP enrollment to AAL2, and a
 * sign-out whose storage deletion is verified.
 *
 * It NEVER runs in `npm test`: it needs the binary stack (or the Docker
 * stack) up, is invoked only through `e2e-binary-stack.mjs bridge`, and
 * refuses to start against anything but a loopback URL.
 */
import type { AuthState } from '@/auth/machine';
import { asMembershipId } from '@/core/ids';

// The reviewed TOTP math the QA helper uses; scripts are plain ESM.
import { totpCode } from '../../scripts/lib/totp.mjs';

import { buildApp, signInWithOtp, waitForState } from './journeys';

// Canonical synthetic identities and rows (scripts/lib/synthetic-identities.mjs
// and supabase/seed.sql). Restated literally so a drifted seed FAILS here
// rather than being re-derived from the thing under test.
const CLIENT_EMAIL = 'client.owner@example.invalid';
const STAFF_EMAIL = 'reviewer.rae@example.invalid';
const A1 = {
  environmentId: '11111111-0000-4000-8000-000000000001',
  clientId: 'aaaaaaaa-0000-4000-8000-000000000001',
  entityId: 'aaaaaaaa-1111-4000-8000-000000000001',
};
const A1_CASE_NEWER = 'eeeeeeee-0000-4000-8000-0000000000a1';
const A1_CASE_OLDER = 'eeeeeeee-0000-4000-8000-0000000000a2';
const B1_REQUEST = 'ffffffff-0000-4000-8000-0000000000b1';

jest.setTimeout(120_000);

describe('live bridge: the shipped composition against the real stack', () => {
  test('client journey: OTP email → workspace choice → all three read surfaces → cross-scope denial → verified sign-out', async () => {
    const app = buildApp();
    await app.controller.boot();
    await waitForState(app.controller, 'boot', (state) => state.name === 'signed_out');

    await signInWithOtp(app, CLIENT_EMAIL);

    // client.owner holds TWO workspaces, so the app must ask — routing
    // straight to authorized would be choosing a scope for the user.
    const chooser = (await waitForState(
      app.controller,
      'workspace chooser',
      (state) => state.name === 'select_scope',
    )) as Extract<AuthState, { name: 'select_scope' }>;
    expect(chooser.memberships).toHaveLength(2);

    const a1 = chooser.memberships.find((membership) => membership.entityId === A1.entityId);
    expect(a1).toBeDefined();
    await app.controller.selectScope(a1!.membershipId);
    const authorized = (await waitForState(
      app.controller,
      'authorized',
      (state) => state.name === 'authorized',
    )) as Extract<AuthState, { name: 'authorized' }>;
    expect(authorized.scope.entityId).toBe(A1.entityId);

    // The three read surfaces through the app's own scoped repositories,
    // against live PostgREST and the real RLS.
    const scope = authorized.scope;
    const home = await app.dashboard.load(scope);
    expect(home.items.map((item) => item.id)).toEqual([A1_CASE_NEWER, A1_CASE_OLDER]);
    expect(home.recordedThrough).not.toBeNull();

    const requests = await app.requests.list(scope);
    expect(requests.items.length).toBeGreaterThanOrEqual(2);
    for (const request of requests.items) expect(request.title).toContain('(Synthetic)');

    const activity = await app.activity.list(scope);
    expect(activity.items.length).toBeGreaterThanOrEqual(1);
    // Threat T3 end to end: the schema has no free-text column, so no
    // entry can carry a name, filename, or amount — only enumerated kinds.
    for (const entry of activity.items) {
      expect(typeof entry.kind).toBe('string');
      expect(entry.kind).toMatch(/^(case|request)\./);
    }

    // Cross-scope: a REAL request id belonging to client B, asked for in
    // an A1 scope. Null, indistinguishable from nonexistence (threat T5).
    const foreign = await app.requests.get(scope, B1_REQUEST);
    expect(foreign).toBeNull();

    // Sign-out: awaited, storage deletion verified by the adapter, and
    // the synthetic backend really is empty afterwards.
    await app.controller.signOut();
    await waitForState(app.controller, 'signed out', (state) => state.name === 'signed_out');
    expect(await app.storage.read()).toBeNull();
    expect(await app.storage.hasResidue()).toBe(false);
    expect(app.backend.keys()).toHaveLength(0);

    // And the accessor is closed: no repository can read after sign-out.
    await expect(app.dashboard.load(scope)).rejects.toThrow();
  });

  test('staff journey: the app never offers a workspace at AAL1 — TOTP enrollment stands between OTP and any scope', async () => {
    const app = buildApp();
    await app.controller.boot();
    await waitForState(app.controller, 'boot', (state) => state.name === 'signed_out');

    await signInWithOtp(app, STAFF_EMAIL);

    // The app-level AAL2 gate: after a staff OTP the ONLY reachable state
    // is mfa_required. select_scope appearing here would mean the app
    // offered protected surface area on one factor.
    const mfa = (await waitForState(
      app.controller,
      'mfa enrollment offered',
      (state) => state.name === 'mfa_required' && state.enrollment !== undefined,
    )) as Extract<AuthState, { name: 'mfa_required' }>;
    expect(mfa.enrollment?.secret).toBeTruthy();

    await app.controller.submitTotp(totpCode(mfa.enrollment!.secret));
    const authorized = (await waitForState(
      app.controller,
      'staff authorized after TOTP',
      (state) => state.name === 'authorized' || state.name === 'select_scope',
    )) as AuthState;

    // reviewer.rae holds exactly one membership; whether the machine
    // auto-selects or asks, the scope the app lands on is the canonical
    // one — and reads now return rows where AAL1 would have had none.
    const scope =
      authorized.name === 'authorized'
        ? authorized.scope
        : (() => {
            throw new Error(`staff landed in ${authorized.name} with one membership`);
          })();
    expect(scope.environmentId).toBe(A1.environmentId);

    const home = await app.dashboard.load(scope);
    expect(home.items.length).toBeGreaterThanOrEqual(1);

    await app.controller.signOut();
    await waitForState(app.controller, 'staff signed out', (state) => state.name === 'signed_out');
    expect(app.backend.keys()).toHaveLength(0);
  });

  test("a second identity on the same install never sees the first identity's scope state", async () => {
    const app = buildApp();
    await app.controller.boot();
    await waitForState(app.controller, 'boot', (state) => state.name === 'signed_out');

    await signInWithOtp(app, CLIENT_EMAIL);
    const chooser = (await waitForState(
      app.controller,
      'first identity chooser',
      (state) => state.name === 'select_scope',
    )) as Extract<AuthState, { name: 'select_scope' }>;
    await app.controller.selectScope(
      asMembershipId(chooser.memberships[0]!.membershipId as unknown as string),
    );
    await waitForState(app.controller, 'first authorized', (state) => state.name === 'authorized');

    await app.controller.signOut();
    await waitForState(
      app.controller,
      'between identities',
      (state) => state.name === 'signed_out',
    );

    // Different person, same install: the machine must start from zero.
    await signInWithOtp(app, 'client.second@example.invalid');
    const second = (await waitForState(
      app.controller,
      'second identity routed',
      (state) => state.name === 'authorized' || state.name === 'select_scope',
    )) as AuthState;
    const memberships =
      second.name === 'authorized' || second.name === 'select_scope' ? second.memberships : [];
    expect(memberships.length).toBeGreaterThanOrEqual(1);
    for (const membership of memberships) {
      expect(membership.clientId).not.toBe(A1.clientId);
    }

    await app.controller.signOut();
    await waitForState(app.controller, 'final sign out', (state) => state.name === 'signed_out');
  });
});
