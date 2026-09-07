import { SafeError } from '@/core/errors';
import { asClientId, asEntityId, asEnvironmentId, asMembershipId } from '@/core/ids';
import { ScopedRegistry } from '@/tenancy/clearing';
import { scopeKeyFromMembership } from '@/tenancy/scope-key';

import { ClientDataAdapter, type ClientDataAccess } from '../adapter';
import { CLIENT_DATA_VERSION, DataFailure, type DataRequest } from '../contract';

const scope = scopeKeyFromMembership({
  membershipId: asMembershipId('11111111-0000-4000-8000-000000000001'),
  environmentId: asEnvironmentId('22222222-0000-4000-8000-000000000001'),
  clientId: asClientId('33333333-0000-4000-8000-000000000001'),
  entityId: asEntityId('44444444-0000-4000-8000-000000000001'),
  role: 'preparer',
  clientName: 'Synthetic client',
  entityName: 'Synthetic entity',
});
const foreignScope = Object.freeze({
  ...scope,
  entityId: asEntityId('44444444-0000-4000-8000-000000000002'),
});
const requestId = '55555555-0000-4000-8000-000000000001';
const summary = {
  id: requestId,
  title: 'Synthetic request',
  status: 'OPEN',
  ownerRole: 'client_user',
  requestedOn: '2026-08-10',
  dueOn: null,
};

function reply(request: DataRequest, result: unknown) {
  return {
    version: CLIENT_DATA_VERSION,
    scope: { ...request.scope },
    operation: request.operation,
    status: 'ok',
    result,
  };
}
function harness(execute: (request: DataRequest, signal: AbortSignal) => Promise<unknown>) {
  let access: ClientDataAccess = { scope, actorId: 'synthetic-actor-a' };
  const registry = new ScopedRegistry();
  const transport = { execute: jest.fn(execute) };
  const adapter = new ClientDataAdapter(transport, () => access, registry);
  return {
    adapter,
    registry,
    transport,
    setAccess: (next: ClientDataAccess) => {
      access = next;
    },
  };
}
function deferred() {
  let resolve!: (value: unknown) => void;
  const promise = new Promise<unknown>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('ClientDataAdapter', () => {
  it('preserves genuine empty results and sends exact scope with no actor or session payload', async () => {
    const h = harness(async (request) => reply(request, { items: [], recordedThrough: null }));
    await expect(h.adapter.list(scope)).resolves.toEqual({ items: [], recordedThrough: null });
    expect(h.transport.execute.mock.calls[0]?.[0]).toEqual({
      version: CLIENT_DATA_VERSION,
      operation: 'requests.list',
      scope: { ...scope },
    });
    expect(h.transport.execute.mock.calls[0]?.[1]).toBeInstanceOf(AbortSignal);
  });

  it('does not turn unavailable data into an empty list', async () => {
    const h = harness(async (request) => ({
      version: CLIENT_DATA_VERSION,
      scope: request.scope,
      operation: request.operation,
      status: 'unavailable',
      reason: 'mapping_required',
    }));
    await expect(h.adapter.list(scope)).rejects.toMatchObject({ code: 'unavailable' });
  });

  it.each([
    { ...summary, status: 'RECONCILED' },
    { ...summary, ownerRole: 'administrator' },
    { ...summary, unrelated: 'unexpected' },
  ])('rejects malformed or expanded request rows', async (row) => {
    const h = harness(async (request) =>
      reply(request, { items: [row], recordedThrough: '2026-08-10' }),
    );
    await expect(h.adapter.list(scope)).rejects.toBeInstanceOf(SafeError);
  });

  it('rejects a response from another scope', async () => {
    const h = harness(async (request) => ({
      ...reply(request, { items: [], recordedThrough: null }),
      scope: foreignScope,
    }));
    await expect(h.adapter.list(scope)).rejects.toMatchObject({ code: 'unavailable' });
  });

  it('keeps the expected request immutable across the transport await', async () => {
    const h = harness(async (request) => {
      expect(Reflect.set(request.scope, 'entityId', foreignScope.entityId)).toBe(false);
      expect(Reflect.set(request, 'operation', 'connections.qbo')).toBe(false);
      return reply(request, { items: [], recordedThrough: null });
    });
    await expect(h.adapter.list(scope)).resolves.toEqual({ items: [], recordedThrough: null });
  });

  it('rejects a caller-selected foreign scope before transport runs', async () => {
    const h = harness(async (request) => reply(request, { items: [], recordedThrough: null }));
    await expect(h.adapter.list(foreignScope)).rejects.toMatchObject({ code: 'stale_scope' });
    expect(h.transport.execute).not.toHaveBeenCalled();
  });

  it('treats the request ID as an exact filter and preserves genuine absence', async () => {
    const h = harness(async (request) => reply(request, null));
    await expect(h.adapter.get(scope, requestId)).resolves.toBeNull();
    expect(h.transport.execute.mock.calls[0]?.[0]).toEqual({
      version: CLIENT_DATA_VERSION,
      operation: 'requests.get',
      scope: { ...scope },
      requestId,
    });
  });

  it('rejects an invalid request ID before transport runs', async () => {
    const h = harness(async (request) => reply(request, null));
    await expect(h.adapter.get(scope, '../foreign')).rejects.toBeInstanceOf(SafeError);
    expect(h.transport.execute).not.toHaveBeenCalled();
  });

  it('rejects a different request returned within the same scope', async () => {
    const h = harness(async (request) =>
      reply(request, {
        ...summary,
        id: '55555555-0000-4000-8000-000000000002',
        detail: 'Synthetic detail',
      }),
    );
    await expect(h.adapter.get(scope, requestId)).rejects.toMatchObject({ code: 'unavailable' });
  });

  it('returns only validated QBO operational metadata', async () => {
    const connection = {
      provider: 'quickbooks_online',
      providerEnvironment: 'sandbox',
      state: 'disconnected',
      lastSyncedAt: null,
    };
    const h = harness(async (request) => reply(request, connection));
    await expect(h.adapter.getQboConnection(scope)).resolves.toEqual(connection);
    expect(h.transport.execute.mock.calls[0]?.[0].operation).toBe('connections.qbo');
  });

  it('aborts and rejects immediately on clear even when transport ignores cancellation', async () => {
    const pending = deferred();
    const h = harness(() => pending.promise);
    const reading = h.adapter.list(scope);
    const rejected = expect(reading).rejects.toMatchObject({ code: 'stale_scope' });
    h.registry.clearAll('scope_switch');
    expect(h.transport.execute.mock.calls[0]?.[1].aborted).toBe(true);
    await rejected;
    pending.resolve(
      reply(h.transport.execute.mock.calls[0]![0], {
        items: [summary],
        recordedThrough: '2026-08-10',
      }),
    );
  });

  it.each(['identity', 'scope'] as const)(
    'checks current %s again after transport resolves',
    async (change) => {
      const pending = deferred();
      const h = harness(() => pending.promise);
      const reading = h.adapter.list(scope);
      h.setAccess(
        change === 'identity'
          ? { scope, actorId: 'synthetic-actor-b' }
          : { scope: foreignScope, actorId: 'synthetic-actor-a' },
      );
      pending.resolve(
        reply(h.transport.execute.mock.calls[0]![0], { items: [], recordedThrough: null }),
      );
      await expect(reading).rejects.toMatchObject({ code: 'stale_scope' });
    },
  );

  it('invalidates earlier reads after an identity switch away and back to the same scope', async () => {
    const pending = deferred();
    const h = harness(() => pending.promise);
    const reading = h.adapter.list(scope);
    const rejected = expect(reading).rejects.toMatchObject({ code: 'stale_scope' });
    h.registry.clearAll('identity_switch');
    h.setAccess({ scope, actorId: 'synthetic-actor-a' });
    pending.resolve(
      reply(h.transport.execute.mock.calls[0]![0], { items: [], recordedThrough: null }),
    );
    await rejected;
  });

  it('allows fresh reads after clear without retaining prior results', async () => {
    const h = harness(async (request) => reply(request, { items: [], recordedThrough: null }));
    await h.adapter.list(scope);
    h.registry.clearAll('scope_switch');
    await expect(h.adapter.list(scope)).resolves.toEqual({ items: [], recordedThrough: null });
    expect(h.transport.execute).toHaveBeenCalledTimes(2);
  });

  it('disposes registration, cancels current reads and blocks later reads', async () => {
    const pending = deferred();
    const h = harness(() => pending.promise);
    const reading = h.adapter.list(scope);
    const rejected = expect(reading).rejects.toMatchObject({ code: 'stale_scope' });
    h.adapter.dispose();
    expect(h.registry.size).toBe(0);
    await rejected;
    await expect(h.adapter.list(scope)).rejects.toMatchObject({ code: 'stale_scope' });
  });

  it.each([
    ['unauthorized', 'auth_expired'],
    ['denied', 'denied'],
    ['unavailable', 'unavailable'],
    ['invalid', 'unavailable'],
  ] as const)('maps transport %s failures to safe %s errors', async (failure, expected) => {
    const h = harness(async () => {
      throw new DataFailure(failure);
    });
    await expect(h.adapter.list(scope)).rejects.toMatchObject({ code: expected });
  });
});
