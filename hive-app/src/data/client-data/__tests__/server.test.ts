import { CLIENT_DATA_VERSION, DataFailure, MAX_REQUESTS, type DataRequest } from '../contract';
import { createClientDataService, type ApprovedMapping } from '../server';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const scope = { environmentId: id(1), clientId: id(2), entityId: id(3), membershipId: id(4) };
const mapping: ApprovedMapping = {
  actorId: id(5),
  scope,
  sourceProjectId: 'syntheticsourceaaaaa',
  sourceEntityId: id(6),
  providerEnvironment: 'sandbox',
  timezone: 'America/Denver',
  active: true,
  mappingApproved: true,
  aal: 'aal2',
  sessionActive: true,
  profileActive: true,
  membershipActive: true,
  entitlementActive: true,
};
const row = (extra = {}) => ({
  id: id(7),
  entity_id: mapping.sourceEntityId,
  title: 'Confirm deposit source',
  reason: 'Identify the originating account.',
  status: 'open',
  due_at: '2026-09-07T01:00:00Z',
  presentation: { approved: true, ownerRole: 'client_user', requestedOn: '2026-09-04' },
  ...extra,
});
const envelope = (value: unknown) => ({
  sourceProjectId: mapping.sourceProjectId,
  sourceEntityId: mapping.sourceEntityId,
  providerEnvironment: mapping.providerEnvironment,
  value,
});
const request = (operation: DataRequest['operation'] = 'requests.list'): DataRequest =>
  operation === 'requests.get'
    ? { version: CLIENT_DATA_VERSION, scope, operation, requestId: id(7) }
    : { version: CLIENT_DATA_VERSION, scope, operation };

function fixture() {
  const authorization = { authorize: jest.fn().mockResolvedValue(mapping) };
  const source = {
    listRequests: jest.fn().mockResolvedValue(envelope([row()])),
    getRequest: jest.fn().mockResolvedValue(envelope(row())),
    getQboConnection: jest.fn().mockResolvedValue(
      envelope({
        integration: {
          entityId: mapping.sourceEntityId,
          provider: 'quickbooks_online',
          environment: 'sandbox',
          status: 'active',
          lastSyncedAt: '2026-09-06T12:00:00Z',
        },
      }),
    ),
  };
  return { authorization, source, service: createClientDataService({ authorization, source }) };
}

describe('client data server bridge', () => {
  test('keeps the existing newest-request-first presentation order', async () => {
    const { source, service } = fixture();
    source.listRequests.mockResolvedValue(
      envelope([
        row({ id: id(9) }),
        row({
          id: id(8),
          presentation: { approved: true, ownerRole: 'client_user', requestedOn: '2026-09-05' },
        }),
      ]),
    );
    expect(await service.read('session', request())).toMatchObject({
      result: { items: [{ id: id(8) }, { id: id(9) }] },
    });
  });

  test('projects approved requests and converts the due date in the entity timezone', async () => {
    const { service, source } = fixture();
    const reply = await service.read('session', request());
    expect(reply).toMatchObject({
      status: 'ok',
      result: {
        items: [{ id: id(7), status: 'OPEN', dueOn: '2026-09-06', ownerRole: 'client_user' }],
        recordedThrough: '2026-09-04',
      },
    });
    expect(source.listRequests).toHaveBeenCalledWith(mapping, { limit: MAX_REQUESTS + 1 });
    expect(JSON.stringify(reply)).not.toMatch(/originating|sourceProjectId|sourceEntityId|actorId/);
  });

  test.each(['environmentId', 'clientId', 'entityId', 'membershipId'] as const)(
    'rejects an authorization mapping for another %s before source access',
    async (key) => {
      const { authorization, source, service } = fixture();
      authorization.authorize.mockResolvedValue({ ...mapping, scope: { ...scope, [key]: id(99) } });
      await expect(service.read('session', request())).rejects.toMatchObject({ code: 'denied' });
      expect(source.listRequests).not.toHaveBeenCalled();
    },
  );

  test.each([
    'active',
    'mappingApproved',
    'sessionActive',
    'profileActive',
    'membershipActive',
    'entitlementActive',
  ] as const)('fails closed when %s is false', async (key) => {
    const { authorization, source, service } = fixture();
    authorization.authorize.mockResolvedValue({ ...mapping, [key]: false });
    await expect(service.read('session', request())).rejects.toBeInstanceOf(DataFailure);
    expect(source.listRequests).not.toHaveBeenCalled();
  });

  test('requires AAL2 and rejects a blank credential', async () => {
    const { authorization, service } = fixture();
    authorization.authorize.mockResolvedValue({ ...mapping, aal: 'aal1' });
    await expect(service.read('session', request())).rejects.toMatchObject({ code: 'denied' });
    authorization.authorize.mockClear();
    await expect(service.read('', request())).rejects.toMatchObject({ code: 'unauthorized' });
    expect(authorization.authorize).not.toHaveBeenCalled();
  });

  test('reports missing bindings without reading data', async () => {
    const { authorization, source, service } = fixture();
    authorization.authorize.mockResolvedValue(null);
    expect(await service.read('session', request())).toMatchObject({
      status: 'unavailable',
      reason: 'mapping_required',
    });
    expect(source.listRequests).not.toHaveBeenCalled();
  });

  test.each(['sourceProjectId', 'sourceEntityId', 'providerEnvironment'] as const)(
    'rejects another source %s',
    async (key) => {
      const { source, service } = fixture();
      source.listRequests.mockResolvedValue({ ...envelope([row()]), [key]: 'other' });
      expect(await service.read('session', request())).toMatchObject({
        status: 'unavailable',
        reason: 'source_unavailable',
      });
    },
  );

  test('foreign detail is indistinguishable from a missing detail', async () => {
    const { source, service } = fixture();
    for (const value of [
      null,
      row({ entity_id: id(99) }),
      row({ id: id(99) }),
      row({ status: 'draft' }),
    ]) {
      source.getRequest.mockResolvedValue(envelope(value));
      expect(await service.read('session', request('requests.get'))).toMatchObject({
        status: 'ok',
        result: null,
      });
    }
  });

  test('a foreign row invalidates the whole list', async () => {
    const { source, service } = fixture();
    source.listRequests.mockResolvedValue(envelope([row(), row({ entity_id: id(99) })]));
    expect(await service.read('session', request())).toMatchObject({
      reason: 'source_unavailable',
    });
  });

  test.each(['accepted', 'cancelled', 'overdue', 'unexpected'])(
    'never converts unsupported status %s into a completed or empty list',
    async (status) => {
      const { source, service } = fixture();
      source.listRequests.mockResolvedValue(envelope([row({ status })]));
      expect(await service.read('session', request())).toMatchObject({
        status: 'unavailable',
        reason: 'unsupported',
      });
    },
  );

  test.each([
    undefined,
    { approved: false },
    { approved: true, ownerRole: 'approver' },
    { approved: true, ownerRole: 'honeybee_lead', requestedOn: '2026-09-04' },
  ])('requires explicit approved request presentation metadata', async (presentation) => {
    const { source, service } = fixture();
    source.listRequests.mockResolvedValue(envelope([row({ presentation })]));
    expect(await service.read('session', request())).toMatchObject({ reason: 'mapping_required' });
  });

  test('suppresses drafts, preserves exact answered/closed statuses, and refuses truncation', async () => {
    const { source, service } = fixture();
    source.listRequests.mockResolvedValue(
      envelope([
        row({ status: 'draft' }),
        row({ status: 'answered', id: id(8) }),
        row({ status: 'closed', id: id(9) }),
      ]),
    );
    expect(await service.read('session', request())).toMatchObject({
      result: { items: [{ status: 'ANSWERED' }, { status: 'CLOSED' }] },
    });
    source.listRequests.mockResolvedValue(
      envelope(Array.from({ length: MAX_REQUESTS + 1 }, (_, i) => row({ id: id(i + 100) }))),
    );
    expect(await service.read('session', request())).toMatchObject({ reason: 'window_exceeded' });
  });

  test.each(['2026-02-30T12:00:00Z', 'bad-date', '2026-09-01T00:00:00Z', '2026-09-06T24:00:00Z'])(
    'rejects invalid dates or due dates before requested date: %s',
    async (due_at) => {
      const { source, service } = fixture();
      source.listRequests.mockResolvedValue(envelope([row({ due_at })]));
      expect(await service.read('session', request())).toMatchObject({
        reason: 'source_unavailable',
      });
    },
  );

  test('returns request detail only for the authorized row', async () => {
    const { service } = fixture();
    expect(await service.read('session', request('requests.get'))).toMatchObject({
      result: { detail: 'Identify the originating account.' },
    });
  });

  test('projects only QBO operational metadata and rejects unknown states', async () => {
    const { source, service } = fixture();
    expect(await service.read('session', request('connections.qbo'))).toMatchObject({
      result: {
        provider: 'quickbooks_online',
        providerEnvironment: 'sandbox',
        state: 'active',
        lastSyncedAt: '2026-09-06T12:00:00Z',
      },
    });
    source.getQboConnection.mockResolvedValue(
      envelope({
        integration: {
          entityId: mapping.sourceEntityId,
          provider: 'quickbooks_online',
          environment: 'sandbox',
          status: 'unknown',
          accessToken: 'restricted-example',
          realmId: 'restricted-company',
        },
      }),
    );
    const rejected = await service.read('session', request('connections.qbo'));
    expect(rejected).toMatchObject({ reason: 'source_unavailable' });
    expect(JSON.stringify(rejected)).not.toMatch(/restricted/);
  });

  test('never includes upstream exception text', async () => {
    const { source, authorization, service } = fixture();
    source.listRequests.mockRejectedValue(new Error('restricted-example'));
    expect(await service.read('session', request())).toMatchObject({
      reason: 'source_unavailable',
    });
    authorization.authorize.mockRejectedValue(new Error('restricted-example'));
    await expect(service.read('session', request())).rejects.toMatchObject({
      message: 'Client data could not be read.',
    });
  });

  test('rechecks authorization on every read and stops after revocation', async () => {
    const { authorization, source, service } = fixture();
    await service.read('session', request());
    authorization.authorize.mockRejectedValue(new DataFailure('denied'));
    await expect(service.read('session', request())).rejects.toMatchObject({ code: 'denied' });
    expect(authorization.authorize).toHaveBeenCalledTimes(2);
    expect(source.listRequests).toHaveBeenCalledTimes(1);
  });

  test('does not expose source person IDs or unrelated fields', async () => {
    const { source, service } = fixture();
    source.getRequest.mockResolvedValue(
      envelope(
        row({
          owner_user_id: 'restricted-owner',
          amount_minor: 45000,
          unrelated: 'restricted-example',
        }),
      ),
    );
    const reply = await service.read('session', request('requests.get'));
    expect(reply.status).toBe('ok');
    expect(JSON.stringify(reply)).not.toMatch(/restricted|amount_minor|owner_user_id/);
  });
});
