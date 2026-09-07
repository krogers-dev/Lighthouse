/** Cross-feature contract for the Milestone 1 read surfaces.
 *
 * The Milestone 0 dashboard already proves scope binding and the P2-9
 * late-response rule. Requests and Activity are new reads on new tables,
 * and the WO-002 threat model calls out policy and behavior DRIFT between
 * surfaces as the risk. So the same contract is asserted here directly,
 * against these screens — not assumed to hold because they share a hook.
 */
import { act, render, screen, waitFor } from '@testing-library/react-native';

import {
  USER_CLIENT,
  USER_MIXED_SAME,
  membershipA1,
  membershipA2,
  membershipMixedClient,
  membershipMixedReviewer,
} from '@/auth/__tests__/fixtures';
import { AuthProvider } from '@/auth/provider';
import type {
  ActivityEntry,
  ActivityLoader,
  RequestDetail,
  RequestSummary,
  RequestsLoader,
  ScopedList,
} from '@/data/supabase/repositories';
import { ActivityScreen } from '@/features/activity/ActivityScreen';
import { RequestDetailScreen } from '@/features/requests/RequestDetailScreen';
import { RequestsScreen } from '@/features/requests/RequestsScreen';
import type { ScopeKey } from '@/tenancy/scope-key';

import { makeContractHarness } from './helpers/auth-harness';

function requestNamed(title: string): RequestSummary {
  return {
    id: `id-${title}`,
    title,
    status: 'OPEN',
    ownerRole: 'client_user',
    requestedOn: '2026-08-10',
    dueOn: null,
  };
}

class ScopeRecordingRequests implements RequestsLoader {
  scopes: ScopeKey[] = [];
  async list(scope: ScopeKey): Promise<ScopedList<RequestSummary>> {
    this.scopes.push(scope);
    const title =
      scope.entityId === membershipA1.entityId
        ? 'Entity A1 request (Synthetic)'
        : 'Entity A2 request (Synthetic)';
    return { items: [requestNamed(title)], recordedThrough: '2026-08-10' };
  }
  async get(): Promise<RequestDetail | null> {
    return null;
  }
}

class DeferredRequests implements RequestsLoader {
  requests: { scope: ScopeKey; respond: (value: ScopedList<RequestSummary>) => void }[] = [];
  list(scope: ScopeKey): Promise<ScopedList<RequestSummary>> {
    return new Promise((resolve) => {
      this.requests.push({ scope, respond: resolve });
    });
  }
  async get(): Promise<RequestDetail | null> {
    return null;
  }
}

class ScopeRecordingActivity implements ActivityLoader {
  scopes: ScopeKey[] = [];
  async list(scope: ScopeKey): Promise<ScopedList<ActivityEntry>> {
    this.scopes.push(scope);
    return {
      items: [
        {
          id: `event-${scope.entityId}`,
          kind: scope.entityId === membershipA1.entityId ? 'request.opened' : 'request.closed',
          actorRole: 'preparer',
          occurredAt: '2026-08-11T09:15:00Z',
        },
      ],
      recordedThrough: '2026-08-11T09:15:00Z',
    };
  }
}

/** Records the id it was asked for, and answers only within scope. */
class ScopedDetailLoader implements RequestsLoader {
  asked: { scope: ScopeKey; requestId: string }[] = [];
  constructor(private readonly reachableId: string) {}
  async list(): Promise<ScopedList<RequestSummary>> {
    return { items: [], recordedThrough: null };
  }
  async get(scope: ScopeKey, requestId: string): Promise<RequestDetail | null> {
    this.asked.push({ scope, requestId });
    if (requestId !== this.reachableId) return null;
    return {
      id: requestId,
      title: 'In-scope request (Synthetic)',
      detail: 'Detail body (Synthetic).',
      status: 'OPEN',
      ownerRole: 'client_user',
      requestedOn: '2026-08-10',
      dueOn: null,
    };
  }
}

describe('requests scope contract', () => {
  it('binds every list read to the selected scope and clears across an entity switch', async () => {
    const harness = makeContractHarness({
      session: { userId: USER_CLIENT, aal: 'aal1', expiresAt: 2_000_000 },
      memberships: new Map([[USER_CLIENT, [membershipA1, membershipA2]]]),
    });
    const loader = new ScopeRecordingRequests();

    await render(
      <AuthProvider controller={harness.controller}>
        <RequestsScreen repository={loader} onOpenRequest={() => undefined} />
      </AuthProvider>,
    );
    await act(async () => harness.controller.settle());
    // Nothing renders before an explicit scope selection.
    expect(screen.queryByTestId('requests')).toBeNull();

    await act(async () => harness.controller.selectScope(membershipA1.membershipId));
    await waitFor(() => expect(screen.getByText('Entity A1 request (Synthetic)')).toBeTruthy());
    expect(loader.scopes[0]?.entityId).toBe(membershipA1.entityId);

    await act(async () => harness.controller.switchScope());
    expect(harness.clearLog).toContain('scope_switch');
    await waitFor(() => expect(screen.queryByTestId('requests')).toBeNull());

    await act(async () => harness.controller.selectScope(membershipA2.membershipId));
    await waitFor(() => expect(screen.getByText('Entity A2 request (Synthetic)')).toBeTruthy());
    // The previous entity's request cannot reappear.
    expect(screen.queryByText('Entity A1 request (Synthetic)')).toBeNull();
    expect(loader.scopes.map((s) => s.entityId)).toEqual([
      membershipA1.entityId,
      membershipA2.entityId,
    ]);
  });

  it('a late response from one membership never renders after switching to another on the SAME entity (P2-9)', async () => {
    // mixed.same: client_user + reviewer on identical environment/client/
    // entity. Only membershipId differs, so this fails if request identity
    // omits membershipId.
    const harness = makeContractHarness({
      session: { userId: USER_MIXED_SAME, aal: 'aal2', expiresAt: 2_000_000 },
      memberships: new Map([[USER_MIXED_SAME, [membershipMixedClient, membershipMixedReviewer]]]),
    });
    const loader = new DeferredRequests();
    await render(
      <AuthProvider controller={harness.controller}>
        <RequestsScreen repository={loader} onOpenRequest={() => undefined} />
      </AuthProvider>,
    );
    await act(async () => harness.controller.settle());

    await act(async () => harness.controller.selectScope(membershipMixedClient.membershipId));
    await waitFor(() => expect(loader.requests).toHaveLength(1));
    expect(loader.requests[0]?.scope.membershipId).toBe(membershipMixedClient.membershipId);

    await act(async () => {
      void harness.controller.switchScope();
      void harness.controller.selectScope(membershipMixedReviewer.membershipId);
      await harness.controller.settle();
    });
    await waitFor(() => expect(loader.requests).toHaveLength(2));
    expect(loader.requests[1]?.scope.membershipId).toBe(membershipMixedReviewer.membershipId);
    expect(screen.getByTestId('requests-loading')).toBeTruthy();

    // The abandoned client_user response arrives late and must be dropped.
    await act(async () => {
      loader.requests[0]?.respond({
        items: [requestNamed('Client-role request (Synthetic)')],
        recordedThrough: '2026-08-10',
      });
    });
    expect(screen.queryByText('Client-role request (Synthetic)')).toBeNull();
    expect(screen.getByTestId('requests-loading')).toBeTruthy();

    await act(async () => {
      loader.requests[1]?.respond({
        items: [requestNamed('Reviewer request (Synthetic)')],
        recordedThrough: '2026-08-10',
      });
    });
    await waitFor(() => expect(screen.getByText('Reviewer request (Synthetic)')).toBeTruthy());
    expect(screen.queryByText('Client-role request (Synthetic)')).toBeNull();
  });
});

describe('request detail scope contract', () => {
  it('passes a route id as a FILTER inside the selected scope, never as scope (T5)', async () => {
    const harness = makeContractHarness({
      session: { userId: USER_CLIENT, aal: 'aal1', expiresAt: 2_000_000 },
      memberships: new Map([[USER_CLIENT, [membershipA1, membershipA2]]]),
    });
    const loader = new ScopedDetailLoader('reachable-id');

    await render(
      <AuthProvider controller={harness.controller}>
        <RequestDetailScreen
          repository={loader}
          requestId="reachable-id"
          onBack={() => undefined}
        />
      </AuthProvider>,
    );
    await act(async () => harness.controller.settle());
    await act(async () => harness.controller.selectScope(membershipA1.membershipId));
    await waitFor(() => expect(screen.getByTestId('request-detail-ready')).toBeTruthy());

    // The scope came from the session, not from the id.
    expect(loader.asked[0]?.requestId).toBe('reachable-id');
    expect(loader.asked[0]?.scope.entityId).toBe(membershipA1.entityId);
    expect(loader.asked[0]?.scope.clientId).toBe(membershipA1.clientId);
  });

  it('shows "not found here" for an id outside the scope, revealing nothing about it', async () => {
    const harness = makeContractHarness({
      session: { userId: USER_CLIENT, aal: 'aal1', expiresAt: 2_000_000 },
      memberships: new Map([[USER_CLIENT, [membershipA1, membershipA2]]]),
    });
    const loader = new ScopedDetailLoader('reachable-id');

    await render(
      <AuthProvider controller={harness.controller}>
        <RequestDetailScreen
          repository={loader}
          requestId="another-workspaces-id"
          onBack={() => undefined}
        />
      </AuthProvider>,
    );
    await act(async () => harness.controller.settle());
    await act(async () => harness.controller.selectScope(membershipA1.membershipId));
    await waitFor(() => expect(screen.getByTestId('request-detail-empty')).toBeTruthy());
    expect(screen.getByText('Request not found here')).toBeTruthy();
    // No content, and nothing that would confirm the request exists.
    expect(screen.queryByTestId('request-detail-ready')).toBeNull();
  });
});

describe('activity scope contract', () => {
  it('binds every activity read to the selected scope and clears across an entity switch', async () => {
    const harness = makeContractHarness({
      session: { userId: USER_CLIENT, aal: 'aal1', expiresAt: 2_000_000 },
      memberships: new Map([[USER_CLIENT, [membershipA1, membershipA2]]]),
    });
    const loader = new ScopeRecordingActivity();

    await render(
      <AuthProvider controller={harness.controller}>
        <ActivityScreen repository={loader} />
      </AuthProvider>,
    );
    await act(async () => harness.controller.settle());
    expect(screen.queryByTestId('activity')).toBeNull();

    await act(async () => harness.controller.selectScope(membershipA1.membershipId));
    await waitFor(() => expect(screen.getByText('Request opened')).toBeTruthy());
    expect(loader.scopes[0]?.entityId).toBe(membershipA1.entityId);

    await act(async () => harness.controller.switchScope());
    await waitFor(() => expect(screen.queryByTestId('activity')).toBeNull());

    await act(async () => harness.controller.selectScope(membershipA2.membershipId));
    await waitFor(() => expect(screen.getByText('Request closed')).toBeTruthy());
    expect(screen.queryByText('Request opened')).toBeNull();
    expect(loader.scopes.map((s) => s.entityId)).toEqual([
      membershipA1.entityId,
      membershipA2.entityId,
    ]);
  });
});
