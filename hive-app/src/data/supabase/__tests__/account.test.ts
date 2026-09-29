import { ScopedRegistry } from '@/tenancy/clearing';

import { AccountRefusedError, AccountRepository, mapAccountError } from '../account';

interface RecordedQuery {
  table: string;
  order: { column: string; ascending: boolean } | null;
  limit: number | null;
}

function makeFakeClient(script: {
  rows?: unknown[];
  rpc?: (name: string, args: Record<string, unknown>) => { data: unknown; error: unknown };
}) {
  const queries: RecordedQuery[] = [];
  const rpcs: { name: string; args: Record<string, unknown> }[] = [];
  const client = {
    from(table: string) {
      const record: RecordedQuery = { table, order: null, limit: null };
      queries.push(record);
      const builder: Record<string, unknown> = {
        select: () => builder,
        order: (column: string, options: { ascending: boolean }) => {
          record.order = { column, ascending: options.ascending };
          return builder;
        },
        limit: (count: number) => {
          record.limit = count;
          return builder;
        },
        then: (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
          resolve({ data: script.rows ?? [], error: null }),
      };
      return builder;
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcs.push({ name, args });
      return script.rpc ? script.rpc(name, args) : { data: null, error: null };
    },
  };
  return { client, queries, rpcs };
}

function repo(client: unknown): AccountRepository {
  return new AccountRepository(() => client as never, new ScopedRegistry());
}

describe('AccountRepository', () => {
  it('reads the latest request of any status, newest first, one row, with no scope filter (the policy admits only the person)', async () => {
    const fake = makeFakeClient({
      rows: [
        {
          id: 'req-1',
          status: 'REQUESTED',
          requested_at: '2026-09-28T20:00:00Z',
          withdrawn_at: null,
          completed_at: null,
        },
      ],
    });
    await expect(repo(fake.client).getLatestDeletionRequest()).resolves.toEqual({
      id: 'req-1',
      status: 'REQUESTED',
      requestedAt: '2026-09-28T20:00:00Z',
      withdrawnAt: null,
      completedAt: null,
    });
    expect(fake.queries).toEqual([
      {
        table: 'account_deletion_requests',
        order: { column: 'requested_at', ascending: false },
        limit: 1,
      },
    ]);
    await expect(repo(makeFakeClient({}).client).getLatestDeletionRequest()).resolves.toBeNull();
    const odd = makeFakeClient({
      rows: [
        { id: 'x', status: 'PENDING', requested_at: 't', withdrawn_at: null, completed_at: null },
      ],
    });
    await expect(repo(odd.client).getLatestDeletionRequest()).resolves.toBeNull();
  });

  it('asks the server to request and to withdraw with the phone-made key, and decodes the receipt', async () => {
    const fake = makeFakeClient({
      rpc: (name) => ({
        data: {
          request_id: 'req-1',
          status: name === 'request_account_deletion' ? 'REQUESTED' : 'WITHDRAWN',
          replayed: false,
        },
        error: null,
      }),
    });
    const r = repo(fake.client);
    await expect(r.requestDeletion('k1')).resolves.toEqual({
      requestId: 'req-1',
      status: 'REQUESTED',
      replayed: false,
    });
    await expect(r.withdrawDeletion('k2')).resolves.toEqual({
      requestId: 'req-1',
      status: 'WITHDRAWN',
      replayed: false,
    });
    expect(fake.rpcs).toEqual([
      { name: 'request_account_deletion', args: { p_idempotency_key: 'k1' } },
      { name: 'withdraw_account_deletion', args: { p_idempotency_key: 'k2' } },
    ]);
  });

  it('turns a refusal token into a typed error, a denial into the safe error, and refuses a malformed receipt', async () => {
    const refused = makeFakeClient({
      rpc: () => ({ data: null, error: { code: 'P0001', message: 'already_requested' } }),
    });
    await expect(repo(refused.client).requestDeletion('k')).rejects.toMatchObject({
      refusal: 'already_requested',
    });
    const denied = makeFakeClient({
      rpc: () => ({ data: null, error: { code: '42501', message: 'staff act only at aal2' } }),
    });
    await expect(repo(denied.client).requestDeletion('k')).rejects.toMatchObject({
      code: 'denied',
    });
    const malformed = makeFakeClient({
      rpc: () => ({ data: { status: 'REQUESTED' }, error: null }),
    });
    await expect(repo(malformed.client).requestDeletion('k')).rejects.toMatchObject({
      code: 'unknown',
    });
  });
});

describe('mapAccountError', () => {
  it('recognizes every token and nothing else', () => {
    expect(mapAccountError({ code: 'P0001', message: 'no_open_request' })).toBeInstanceOf(
      AccountRefusedError,
    );
    expect(mapAccountError({ code: 'P0001', message: 'something internal' })).toMatchObject({
      code: 'unknown',
    });
  });
});
