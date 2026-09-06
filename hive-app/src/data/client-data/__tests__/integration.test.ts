import { asClientId, asEntityId, asEnvironmentId, asMembershipId } from '@/core/ids';
import { ScopedRegistry } from '@/tenancy/clearing';
import { scopeKeyFromMembership } from '@/tenancy/scope-key';

import { ClientDataAdapter } from '../adapter';
import { DataFailure } from '../contract';
import { createClientDataService, type ApprovedMapping, type SourceEnvelope } from '../server';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const scope = scopeKeyFromMembership({
  environmentId: asEnvironmentId(id(1)),
  clientId: asClientId(id(2)),
  entityId: asEntityId(id(3)),
  membershipId: asMembershipId(id(4)),
  role: 'client_user',
  clientName: 'Client A (Synthetic)',
  entityName: 'Entity A (Synthetic)',
});
const mapping: ApprovedMapping = {
  scope,
  actorId: id(5),
  sourceEntityId: id(6),
  sourceProjectId: 'syntheticsourceaaaaa',
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
const row = {
  id: id(7),
  entity_id: id(6),
  title: 'Deposit evidence (Synthetic)',
  reason: 'Identify the deposit source (Synthetic).',
  status: 'open',
  due_at: '2026-09-07T01:00:00Z',
  presentation: { approved: true, ownerRole: 'client_user', requestedOn: '2026-09-04' },
};
const envelope = (value: unknown): SourceEnvelope => ({
  sourceProjectId: mapping.sourceProjectId,
  sourceEntityId: mapping.sourceEntityId,
  providerEnvironment: mapping.providerEnvironment,
  value,
});

describe('mobile adapter through the server projection (synthetic)', () => {
  const authorization = { authorize: jest.fn(async () => mapping) };
  const source = {
    listRequests: jest.fn(async () => envelope([row])),
    getRequest: jest.fn(async () => envelope(row)),
    getQboConnection: jest.fn(async () =>
      envelope({
        integration: {
          entityId: mapping.sourceEntityId,
          provider: 'quickbooks_online',
          environment: 'sandbox',
          status: 'refresh_required',
          lastSyncedAt: '2026-09-01T01:00:00Z',
        },
      }),
    ),
  };

  beforeEach(() => {
    authorization.authorize.mockReset().mockResolvedValue(mapping);
    source.listRequests.mockReset().mockResolvedValue(envelope([row]));
  });

  function adapter() {
    const service = createClientDataService({ authorization, source });
    return new ClientDataAdapter(
      { execute: async (request) => service.read('synthetic-session', request) },
      () => ({ scope, actorId: mapping.actorId }),
      new ScopedRegistry(),
    );
  }

  it('supplies the existing RequestsLoader shape with timezone-correct dates and QBO metadata', async () => {
    const client = adapter();
    expect(await client.list(scope)).toEqual({
      items: [
        {
          id: id(7),
          title: row.title,
          status: 'OPEN',
          ownerRole: 'client_user',
          requestedOn: '2026-09-04',
          dueOn: '2026-09-06',
        },
      ],
      recordedThrough: '2026-09-04',
    });
    expect(await client.get(scope, id(7))).toMatchObject({ detail: row.reason });
    expect(await client.getQboConnection(scope)).toEqual({
      provider: 'quickbooks_online',
      providerEnvironment: 'sandbox',
      state: 'refresh_required',
      lastSyncedAt: '2026-09-01T01:00:00Z',
    });
    client.dispose();
  });

  it('fails visibly when the legacy source cannot supply approved presentation fields', async () => {
    source.listRequests.mockResolvedValue(envelope([{ ...row, presentation: null }]));
    const client = adapter();
    await expect(client.list(scope)).rejects.toMatchObject({ code: 'unavailable' });
    client.dispose();
  });

  it('reevaluates access and denies a revoked membership on the next read', async () => {
    const client = adapter();
    await client.list(scope);
    authorization.authorize.mockRejectedValue(new DataFailure('denied'));
    await expect(client.list(scope)).rejects.toMatchObject({ code: 'denied' });
    expect(source.listRequests).toHaveBeenCalledTimes(1);
    client.dispose();
  });

  it('does not display a source row from another entity', async () => {
    source.listRequests.mockResolvedValue(envelope([{ ...row, entity_id: id(99) }]));
    const client = adapter();
    await expect(client.list(scope)).rejects.toMatchObject({ code: 'unavailable' });
    client.dispose();
  });
});
