import { CLIENT_DATA_VERSION, DataFailure, MAX_REQUESTS } from '../contract';
import { parseDataReply, parseDataRequest } from '../validation';

const scope = {
  environmentId: '11111111-1111-4111-8111-111111111111',
  clientId: '22222222-2222-4222-8222-222222222222',
  entityId: '33333333-3333-4333-8333-333333333333',
  membershipId: '44444444-4444-4444-8444-444444444444',
};
const request = { version: CLIENT_DATA_VERSION, operation: 'requests.list' as const, scope };
const item = {
  id: '55555555-5555-4555-8555-555555555555',
  title: 'Synthetic evidence request',
  status: 'OPEN',
  ownerRole: 'client_user',
  requestedOn: '2026-09-01',
  dueOn: null,
};
const reply = {
  ...request,
  status: 'ok',
  result: { items: [item], recordedThrough: '2026-09-01' },
};

describe('client-data v1 boundary', () => {
  it('rejects arrays that stringify to valid enum labels', () => {
    expect(() => parseDataRequest({ ...request, operation: ['requests.list'] })).toThrow(
      DataFailure,
    );
    for (const key of ['status', 'ownerRole'] as const) {
      expect(() =>
        parseDataReply(
          { ...reply, result: { ...reply.result, items: [{ ...item, [key]: [item[key]] }] } },
          request,
        ),
      ).toThrow(DataFailure);
    }
    expect(() =>
      parseDataReply({ ...request, status: 'unavailable', reason: ['unsupported'] }, request),
    ).toThrow(DataFailure);
    const command = { ...request, operation: 'connections.qbo' as const };
    const result = {
      provider: 'quickbooks_online',
      providerEnvironment: 'sandbox',
      state: 'active',
      lastSyncedAt: null,
    };
    for (const key of ['providerEnvironment', 'state'] as const) {
      expect(() =>
        parseDataReply(
          { ...command, status: 'ok', result: { ...result, [key]: [result[key]] } },
          command,
        ),
      ).toThrow(DataFailure);
    }
  });

  it('accepts exact scoped request and response shapes', () => {
    expect(parseDataRequest(request)).toEqual(request);
    expect(parseDataReply(reply, request)).toEqual(reply);
  });

  it.each(['environmentId', 'clientId', 'entityId', 'membershipId'])(
    'rejects a foreign %s',
    (key) => {
      expect(() =>
        parseDataReply({ ...reply, scope: { ...scope, [key]: item.id } }, request),
      ).toThrow(DataFailure);
    },
  );

  it.each([
    { ...request, version: 'v0' },
    { ...request, operation: 'requests.delete' },
    { ...request, requestId: item.id },
    { ...request, scope: { ...scope, userRole: 'approver' } },
    { ...request, scope: { ...scope, membershipId: 'not-an-id' } },
  ])('rejects unsupported or forged requests', (value) => {
    expect(() => parseDataRequest(value)).toThrow(DataFailure);
  });

  it.each([
    { ...reply, version: 'v2' },
    { ...reply, operation: 'connections.qbo' },
    { ...reply, token: 'synthetic-sensitive-field' },
    { ...reply, result: { ...reply.result, complete: false } },
    {
      ...reply,
      result: { items: [{ ...item, status: 'ACCEPTED' }], recordedThrough: '2026-09-01' },
    },
    {
      ...reply,
      result: { items: [{ ...item, ownerRole: 'owner' }], recordedThrough: '2026-09-01' },
    },
    {
      ...reply,
      result: { items: [{ ...item, dueOn: '2026-02-30' }], recordedThrough: '2026-09-01' },
    },
    {
      ...reply,
      result: { items: [{ ...item, title: 'x'.repeat(501) }], recordedThrough: '2026-09-01' },
    },
    { ...reply, result: { items: [item], recordedThrough: '2026-09-02' } },
    { ...reply, result: { items: [item, item], recordedThrough: '2026-09-01' } },
    {
      ...reply,
      result: {
        items: Array.from({ length: MAX_REQUESTS + 1 }, () => item),
        recordedThrough: '2026-09-01',
      },
    },
  ])('rejects unrecognized, misleading or oversized responses', (value) => {
    expect(() => parseDataReply(value, request)).toThrow(DataFailure);
  });

  it('distinguishes unavailable from a truly empty source', () => {
    const empty = { ...reply, result: { items: [], recordedThrough: null } };
    expect(parseDataReply(empty, request)).toEqual(empty);
    const unavailable = { ...request, status: 'unavailable', reason: 'mapping_required' };
    expect(parseDataReply(unavailable, request)).toEqual(unavailable);
    expect(() => parseDataReply({ ...unavailable, result: empty.result }, request)).toThrow(
      DataFailure,
    );
  });

  it('requires exact request ID on a detail response', () => {
    const detailRequest = { ...request, operation: 'requests.get' as const, requestId: item.id };
    const detailReply = {
      ...detailRequest,
      status: 'ok',
      result: { ...item, detail: 'Synthetic text' },
    };
    // requestId belongs in the command, not the response envelope.
    const { requestId: _id, ...wireReply } = detailReply;
    expect(parseDataReply(wireReply, detailRequest).status).toBe('ok');
    expect(() =>
      parseDataReply(
        { ...wireReply, result: { ...wireReply.result, id: scope.entityId } },
        detailRequest,
      ),
    ).toThrow(DataFailure);
    expect(parseDataReply({ ...wireReply, result: null }, detailRequest).status).toBe('ok');
  });

  it('keeps QBO connection metadata separate from workflow approval and credentials', () => {
    const command = { ...request, operation: 'connections.qbo' as const };
    const result = {
      provider: 'quickbooks_online',
      providerEnvironment: 'sandbox',
      state: 'active',
      lastSyncedAt: '2026-09-01T10:00:00+00:00',
    };
    expect(parseDataReply({ ...command, status: 'ok', result }, command).status).toBe('ok');
    for (const bad of [
      { ...result, state: 'APPROVED' },
      { ...result, providerEnvironment: null },
      { ...result, lastSyncedAt: '2026-02-30T10:00:00Z' },
      { ...result, realmId: 'synthetic-only' },
    ])
      expect(() => parseDataReply({ ...command, status: 'ok', result: bad }, command)).toThrow(
        DataFailure,
      );
  });
});
