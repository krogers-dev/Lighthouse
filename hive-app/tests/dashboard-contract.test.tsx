/** Cross-feature contract: scope binding drives every dashboard read, and
 * switching entity clears the screen so prior content can never show. */
import { act, render, screen, waitFor } from '@testing-library/react-native';

import { AuthProvider } from '@/auth/provider';
import {
  USER_CLIENT,
  USER_MIXED_SAME,
  membershipA1,
  membershipA2,
  membershipMixedClient,
  membershipMixedReviewer,
} from '@/auth/__tests__/fixtures';
import type { CaseSummary, DashboardLoader, ScopedList } from '@/data/supabase/repositories';
import { DashboardScreen } from '@/features/dashboard/DashboardScreen';
import type { ScopeKey } from '@/tenancy/scope-key';

import { makeContractHarness } from './helpers/auth-harness';

function snapshotFor(title: string): ScopedList<CaseSummary> {
  return {
    items: [
      {
        id: `case-${title}`,
        title,
        status: 'EVIDENCE_PENDING',
        statusChangedAt: '2026-08-21T00:00:00Z',
        attentionSummary: `${title} attention`,
        nextActionSummary: `${title} next action`,
        nextActionOwnerRole: 'client_user',
      },
    ],
    recordedThrough: '2026-08-21T00:00:00Z',
  };
}

class ScopeRecordingLoader implements DashboardLoader {
  scopes: ScopeKey[] = [];
  async load(scope: ScopeKey): Promise<ScopedList<CaseSummary>> {
    this.scopes.push(scope);
    if (scope.entityId === membershipA1.entityId) {
      return snapshotFor('Entity A1 case (Synthetic)');
    }
    return snapshotFor('Entity A2 case (Synthetic)');
  }
}

/** Loader whose responses resolve only when the test says so, so response
 * ordering can be forced (late responses, out-of-order completion). */
class DeferredLoader implements DashboardLoader {
  requests: { scope: ScopeKey; respond: (snapshot: ScopedList<CaseSummary>) => void }[] = [];
  load(scope: ScopeKey): Promise<ScopedList<CaseSummary>> {
    return new Promise((resolve) => {
      this.requests.push({ scope, respond: resolve });
    });
  }
}

describe('dashboard scope contract', () => {
  it('binds reads to the selected scope and clears content across an entity switch', async () => {
    const harness = makeContractHarness({
      session: { userId: USER_CLIENT, aal: 'aal1', expiresAt: 2_000_000 },
      memberships: new Map([[USER_CLIENT, [membershipA1, membershipA2]]]),
    });
    const loader = new ScopeRecordingLoader();

    await render(
      <AuthProvider controller={harness.controller}>
        <DashboardScreen repository={loader} />
      </AuthProvider>,
    );
    await act(async () => harness.controller.settle());
    expect(harness.controller.getState().name).toBe('select_scope');
    // Nothing renders before an explicit scope selection.
    expect(screen.queryByTestId('dashboard')).toBeNull();

    await act(async () => harness.controller.selectScope(membershipA1.membershipId));
    await waitFor(() => expect(screen.getByText('Entity A1 case (Synthetic)')).toBeTruthy());
    expect(loader.scopes[0]?.entityId).toBe(membershipA1.entityId);

    // Entity switch: repositories clear and the dashboard unmounts.
    await act(async () => harness.controller.switchScope());
    expect(harness.clearLog).toContain('scope_switch');
    await waitFor(() => expect(screen.queryByTestId('dashboard')).toBeNull());
    expect(screen.queryByText('Entity A1 case (Synthetic)')).toBeNull();

    await act(async () => harness.controller.selectScope(membershipA2.membershipId));
    await waitFor(() => expect(screen.getByText('Entity A2 case (Synthetic)')).toBeTruthy());
    // Prior entity content cannot reappear.
    expect(screen.queryByText('Entity A1 case (Synthetic)')).toBeNull();
    expect(loader.scopes.map((s) => s.entityId)).toEqual([
      membershipA1.entityId,
      membershipA2.entityId,
    ]);
  });

  it('a late response from one membership never renders after switching to another membership on the same entity (P2-9)', async () => {
    // mixed.same mirror: client_user + reviewer memberships on the SAME
    // environment/client/entity. Only membershipId distinguishes the two,
    // so this fails if request identity omits membershipId.
    const harness = makeContractHarness({
      session: { userId: USER_MIXED_SAME, aal: 'aal2', expiresAt: 2_000_000 },
      memberships: new Map([[USER_MIXED_SAME, [membershipMixedClient, membershipMixedReviewer]]]),
    });
    const loader = new DeferredLoader();
    await render(
      <AuthProvider controller={harness.controller}>
        <DashboardScreen repository={loader} />
      </AuthProvider>,
    );
    await act(async () => harness.controller.settle());
    expect(harness.controller.getState().name).toBe('select_scope');

    // Request 1 starts under the client_user membership and stays pending.
    await act(async () => harness.controller.selectScope(membershipMixedClient.membershipId));
    await waitFor(() => expect(loader.requests).toHaveLength(1));
    expect(loader.requests[0]?.scope.membershipId).toBe(membershipMixedClient.membershipId);
    expect(screen.getByTestId('dashboard-loading')).toBeTruthy();

    // Switch to the reviewer membership on the same entity while request 1
    // is still in flight. Request 2 starts; the screen must be loading.
    await act(async () => {
      void harness.controller.switchScope();
      void harness.controller.selectScope(membershipMixedReviewer.membershipId);
      await harness.controller.settle();
    });
    await waitFor(() => expect(loader.requests).toHaveLength(2));
    expect(loader.requests[1]?.scope.membershipId).toBe(membershipMixedReviewer.membershipId);
    expect(screen.getByTestId('dashboard-loading')).toBeTruthy();

    // The LATE response for the abandoned client_user request arrives now.
    await act(async () => {
      loader.requests[0]?.respond(snapshotFor('Client-role view (Synthetic)'));
    });
    // It must never render: still loading, no stale membership content.
    expect(screen.queryByText('Client-role view (Synthetic)')).toBeNull();
    expect(screen.getByTestId('dashboard-loading')).toBeTruthy();

    // The reviewer response renders normally.
    await act(async () => {
      loader.requests[1]?.respond(snapshotFor('Reviewer view (Synthetic)'));
    });
    await waitFor(() => expect(screen.getByText('Reviewer view (Synthetic)')).toBeTruthy());
    expect(screen.queryByText('Client-role view (Synthetic)')).toBeNull();

    // Same switch in reverse, with the reviewer response already rendered:
    // switching membership (same entity) must clear content immediately —
    // no stale reviewer content while the client_user request is pending.
    await act(async () => {
      void harness.controller.switchScope();
      void harness.controller.selectScope(membershipMixedClient.membershipId);
      await harness.controller.settle();
    });
    await waitFor(() => expect(loader.requests).toHaveLength(3));
    expect(screen.queryByText('Reviewer view (Synthetic)')).toBeNull();
    expect(screen.getByTestId('dashboard-loading')).toBeTruthy();

    await act(async () => {
      loader.requests[2]?.respond(snapshotFor('Client-role view two (Synthetic)'));
    });
    await waitFor(() => expect(screen.getByText('Client-role view two (Synthetic)')).toBeTruthy());
  });

  it('identity sign-out removes all dashboard content', async () => {
    const harness = makeContractHarness({
      session: { userId: USER_CLIENT, aal: 'aal1', expiresAt: 2_000_000 },
      memberships: new Map([[USER_CLIENT, [membershipA1]]]),
    });
    const loader = new ScopeRecordingLoader();
    await render(
      <AuthProvider controller={harness.controller}>
        <DashboardScreen repository={loader} />
      </AuthProvider>,
    );
    await act(async () => harness.controller.settle());
    await waitFor(() => expect(screen.getByText('Entity A1 case (Synthetic)')).toBeTruthy());

    await act(async () => harness.controller.switchIdentity());
    expect(harness.clearLog).toContain('identity_switch');
    await waitFor(() => expect(screen.queryByTestId('dashboard')).toBeNull());
    expect(harness.controller.getState().name).toBe('signed_out');
  });
});
