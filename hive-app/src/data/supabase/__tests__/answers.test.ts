import { SafeError } from '@/core/errors';
import { ScopedRegistry } from '@/tenancy/clearing';
import type { ScopeKey } from '@/tenancy/scope-key';

import { AnswerRefusedError, AnswersRepository, mapAnswerError } from '../answers';

const scope = {
  environmentId: '11111111-0000-4000-8000-000000000001',
  clientId: 'aaaaaaaa-0000-4000-8000-000000000001',
  entityId: 'aaaaaaaa-1111-4000-8000-000000000001',
  membershipId: 'mmmmmmmm-0000-4000-8000-000000000001',
} as unknown as ScopeKey;

const REQUEST = 'dddddddd-0000-4000-8000-0000000000a3';

interface RecordedQuery {
  table: string;
  filters: Record<string, string>;
  limit: number | null;
}

interface RecordedRpc {
  name: string;
  args: Record<string, unknown>;
}

function makeFakeClient(script: {
  rowsByTable?: Record<string, unknown[]>;
  rpc?: (name: string, args: Record<string, unknown>) => { data: unknown; error: unknown };
}) {
  const queries: RecordedQuery[] = [];
  const rpcs: RecordedRpc[] = [];
  const client = {
    from(table: string) {
      const record: RecordedQuery = { table, filters: {}, limit: null };
      queries.push(record);
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: (column: string, value: string) => {
          record.filters[column] = value;
          return builder;
        },
        order: () => builder,
        limit: (n: number) => {
          record.limit = n;
          return builder;
        },
        then: (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
          resolve({ data: script.rowsByTable?.[table] ?? [], error: null }),
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

function repo(client: unknown): AnswersRepository {
  return new AnswersRepository(() => client as never, new ScopedRegistry());
}

describe('AnswersRepository.get', () => {
  it('reads the answer and its citations inside the full scope, the request id only a filter', async () => {
    const fake = makeFakeClient({
      rowsByTable: {
        request_answers: [
          {
            id: 'ans-1',
            request_id: REQUEST,
            status: 'DRAFT',
            body: 'Yes (Synthetic).',
            version: 2,
            submitted_at: null,
            updated_at: '2026-09-28T16:00:00Z',
          },
        ],
        request_answer_citations: [{ document_id: 'doc-a' }, { document_id: 'doc-b' }],
      },
    });
    const answer = await repo(fake.client).get(scope, REQUEST);
    expect(answer).toEqual({
      id: 'ans-1',
      requestId: REQUEST,
      status: 'DRAFT',
      body: 'Yes (Synthetic).',
      version: 2,
      citedDocumentIds: ['doc-a', 'doc-b'],
      submittedAt: null,
      updatedAt: '2026-09-28T16:00:00Z',
    });
    expect(fake.queries[0]).toMatchObject({
      table: 'request_answers',
      filters: {
        environment_id: scope.environmentId,
        client_id: scope.clientId,
        entity_id: scope.entityId,
        request_id: REQUEST,
      },
      limit: 1,
    });
    expect(fake.queries[1]).toMatchObject({
      table: 'request_answer_citations',
      filters: {
        environment_id: scope.environmentId,
        client_id: scope.clientId,
        entity_id: scope.entityId,
        answer_id: 'ans-1',
      },
    });
  });

  it('returns null, and asks nothing more, when no answer exists', async () => {
    const fake = makeFakeClient({});
    await expect(repo(fake.client).get(scope, REQUEST)).resolves.toBeNull();
    expect(fake.queries).toHaveLength(1);
  });
});

describe('AnswersRepository writes', () => {
  it('saveDraft sends the exact scope, both versions, the text, and the citations', async () => {
    const fake = makeFakeClient({
      rpc: () => ({
        data: {
          answer_id: 'ans-1',
          status: 'DRAFT',
          version: 1,
          updated_at: '2026-09-28T16:00:00Z',
        },
        error: null,
      }),
    });
    const receipt = await repo(fake.client).saveDraft(scope, {
      requestId: REQUEST,
      requestVersion: 2,
      body: 'Yes (Synthetic).',
      citedDocumentIds: ['doc-a'],
      answerVersion: null,
    });
    expect(fake.rpcs[0]).toEqual({
      name: 'save_request_answer_draft',
      args: {
        p_environment_id: scope.environmentId,
        p_client_id: scope.clientId,
        p_entity_id: scope.entityId,
        p_request_id: REQUEST,
        p_request_version: 2,
        p_body: 'Yes (Synthetic).',
        p_cited_document_ids: ['doc-a'],
      },
    });
    expect(receipt).toEqual({
      answerId: 'ans-1',
      status: 'DRAFT',
      version: 1,
      updatedAt: '2026-09-28T16:00:00Z',
    });
  });

  it('saveDraft names the answer version once a draft exists', async () => {
    const fake = makeFakeClient({
      rpc: () => ({
        data: { answer_id: 'ans-1', status: 'DRAFT', version: 3, updated_at: 'x' },
        error: null,
      }),
    });
    await repo(fake.client).saveDraft(scope, {
      requestId: REQUEST,
      requestVersion: 2,
      body: 'again',
      citedDocumentIds: [],
      answerVersion: 2,
    });
    expect(fake.rpcs[0]?.args).toMatchObject({ p_answer_version: 2, p_cited_document_ids: [] });
  });

  it('submit sends the answer version and the phone-made key and returns the receipt', async () => {
    const fake = makeFakeClient({
      rpc: () => ({
        data: {
          answer_id: 'ans-1',
          status: 'SUBMITTED',
          version: 4,
          submitted_at: '2026-09-28T16:05:00Z',
        },
        error: null,
      }),
    });
    const receipt = await repo(fake.client).submit({
      answerId: 'ans-1',
      answerVersion: 3,
      idempotencyKey: 'aaaa2222-0000-4000-8000-000000000001',
    });
    expect(fake.rpcs[0]).toEqual({
      name: 'submit_request_answer',
      args: {
        p_answer_id: 'ans-1',
        p_answer_version: 3,
        p_idempotency_key: 'aaaa2222-0000-4000-8000-000000000001',
      },
    });
    expect(receipt).toEqual({
      answerId: 'ans-1',
      status: 'SUBMITTED',
      version: 4,
      submittedAt: '2026-09-28T16:05:00Z',
    });
  });

  it('turns a refusal token into an AnswerRefusedError and a denial into the safe error', async () => {
    const refused = makeFakeClient({
      rpc: () => ({ data: null, error: { code: 'P0001', message: 'answer_changed' } }),
    });
    await expect(
      repo(refused.client).submit({ answerId: 'a', answerVersion: 1, idempotencyKey: 'k' }),
    ).rejects.toMatchObject({ refusal: 'answer_changed' });
    const denied = makeFakeClient({
      rpc: () => ({ data: null, error: { code: '42501', message: 'staff act only at aal2' } }),
    });
    await expect(
      repo(denied.client).saveDraft(scope, {
        requestId: REQUEST,
        requestVersion: 1,
        body: 'x',
        citedDocumentIds: [],
        answerVersion: null,
      }),
    ).rejects.toMatchObject({ code: 'denied' });
  });

  it('refuses a malformed receipt rather than trusting it', async () => {
    const fake = makeFakeClient({ rpc: () => ({ data: { answer_id: 'a' }, error: null }) });
    await expect(
      repo(fake.client).submit({ answerId: 'a', answerVersion: 1, idempotencyKey: 'k' }),
    ).rejects.toMatchObject({ code: 'unknown' });
  });
});

describe('mapAnswerError', () => {
  it('recognizes every token and nothing else', () => {
    expect(mapAnswerError({ code: 'P0001', message: 'too_many_citations' })).toBeInstanceOf(
      AnswerRefusedError,
    );
    expect(mapAnswerError({ code: 'P0001', message: 'something internal' })).toMatchObject({
      code: 'unknown',
    });
    expect(mapAnswerError({ code: 'PGRST301', message: 'JWT expired' })).toMatchObject({
      code: 'auth_expired',
    });
    expect(mapAnswerError(new SafeError('offline')).message).toBe(new SafeError('offline').message);
  });
});
