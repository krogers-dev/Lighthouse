/** Cross-feature contract: scope binding drives every dashboard read, and
 * switching entity clears the screen so prior content can never show. */
import { act, render, screen, waitFor } from '@testing-library/react-native';

import { AuthProvider } from '@/auth/provider';
import {
  USER_CLIENT,
  membershipA1,
  membershipA2,
} from '@/auth/__tests__/fixtures';
import type { DashboardLoader, DashboardSnapshot } from '@/data/supabase/repositories';
import { DashboardScreen } from '@/features/dashboard/DashboardScreen';
import type { ScopeKey } from '@/tenancy/scope-key';

import { makeContractHarness } from './helpers/auth-harness';

function snapshotFor(title: string): DashboardSnapshot {
  return {
    caseTitle: title,
    caseStatus: 'EVIDENCE_PENDING',
    statusChangedAt: '2026-08-21T00:00:00Z',
    attentionSummary: `${title} attention`,
    nextActionSummary: `${title} next action`,
    nextActionOwnerRole: 'client_user',
  };
}

class ScopeRecordingLoader implements DashboardLoader {
  scopes: ScopeKey[] = [];
  async load(scope: ScopeKey): Promise<DashboardSnapshot> {
    this.scopes.push(scope);
    if (scope.entityId === membershipA1.entityId) {
      return snapshotFor('Entity A1 case (Synthetic)');
    }
    return snapshotFor('Entity A2 case (Synthetic)');
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
        <DashboardScreen repository={loader} onOpenSettings={() => undefined} />
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

  it('identity sign-out removes all dashboard content', async () => {
    const harness = makeContractHarness({
      session: { userId: USER_CLIENT, aal: 'aal1', expiresAt: 2_000_000 },
      memberships: new Map([[USER_CLIENT, [membershipA1]]]),
    });
    const loader = new ScopeRecordingLoader();
    await render(
      <AuthProvider controller={harness.controller}>
        <DashboardScreen repository={loader} onOpenSettings={() => undefined} />
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
