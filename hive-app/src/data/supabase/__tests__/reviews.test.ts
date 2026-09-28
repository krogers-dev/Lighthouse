import { ScopedRegistry } from '@/tenancy/clearing';
import type { ScopeKey } from '@/tenancy/scope-key';

import { ReviewRefusedError, ReviewRepository, decodeManifest, mapReviewError } from '../reviews';

const scope = {
  environmentId: '11111111-0000-4000-8000-000000000001',
  clientId: 'aaaaaaaa-0000-4000-8000-000000000001',
  entityId: 'aaaaaaaa-1111-4000-8000-000000000001',
  membershipId: 'mmmmmmmm-0000-4000-8000-000000000001',
} as unknown as ScopeKey;

const CASE = 'eeeeeeee-0000-4000-8000-0000000000a1';

interface RecordedQuery {
  table: string;
  filters: Record<string, string | null>;
}

function makeFakeClient(script: {
  rowsByTable?: Record<string, unknown[]>;
  rpc?: (name: string, args: Record<string, unknown>) => { data: unknown; error: unknown };
}) {
  const queries: RecordedQuery[] = [];
  const rpcs: { name: string; args: Record<string, unknown> }[] = [];
  const client = {
    from(table: string) {
      const record: RecordedQuery = { table, filters: {} };
      queries.push(record);
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: (column: string, value: string) => {
          record.filters[column] = value;
          return builder;
        },
        is: (column: string, value: null) => {
          record.filters[column] = value;
          return builder;
        },
        order: () => builder,
        limit: () => builder,
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

function repo(client: unknown): ReviewRepository {
  return new ReviewRepository(() => client as never, new ScopedRegistry());
}

const scopeFilters = {
  environment_id: scope.environmentId,
  client_id: scope.clientId,
  entity_id: scope.entityId,
};

describe('ReviewRepository reads', () => {
  it('reads the case inside the full scope, the id only a filter', async () => {
    const fake = makeFakeClient({
      rowsByTable: {
        cases: [
          {
            id: CASE,
            title: '2025 books close (Synthetic)',
            status: 'EVIDENCE_PENDING',
            status_changed_at: '2026-08-21T00:00:00Z',
            version: 3,
          },
        ],
      },
    });
    const record = await repo(fake.client).getCase(scope, CASE);
    expect(record).toEqual({
      id: CASE,
      title: '2025 books close (Synthetic)',
      status: 'EVIDENCE_PENDING',
      statusChangedAt: '2026-08-21T00:00:00Z',
      version: 3,
    });
    expect(fake.queries[0]).toEqual({ table: 'cases', filters: { ...scopeFilters, id: CASE } });
    await expect(repo(makeFakeClient({}).client).getCase(scope, CASE)).resolves.toBeNull();
  });

  it('reads the current package with its manifest decoded, and the verdicts and approvals on it', async () => {
    const fake = makeFakeClient({
      rowsByTable: {
        case_review_packages: [
          {
            id: 'pkg-1',
            package_number: 2,
            manifest: {
              case_id: CASE,
              requests: [{ id: 'r1', status: 'OPEN', version: 1 }],
              answers: [],
              documents: [{ id: 'd1', request_id: 'r1', client_digest: 'ab', byte_size: 10 }],
              unknown_field: 'ignored',
            },
            manifest_digest: 'c'.repeat(64),
            case_version: 5,
            frozen_role: 'preparer',
            frozen_at: '2026-09-28T17:00:00Z',
          },
        ],
        case_reviews: [
          {
            id: 'rev-1',
            reviewer_role: 'reviewer',
            status: 'RECORDED',
            verdict: 'PASS',
            note: '',
            started_at: '2026-09-28T17:01:00Z',
            recorded_at: '2026-09-28T17:02:00Z',
          },
        ],
        case_approvals: [
          {
            id: 'app-1',
            status: 'ACTIVE',
            package_number: 2,
            package_digest: 'c'.repeat(64),
            destination: 'hive-record',
            approved_at: '2026-09-28T17:03:00Z',
            expires_at: '2026-10-28T17:03:00Z',
            ended_at: null,
            end_reason: null,
          },
        ],
      },
    });
    const r = repo(fake.client);
    const current = await r.getCurrentPackage(scope, CASE);
    expect(current).toMatchObject({
      id: 'pkg-1',
      packageNumber: 2,
      manifestDigest: 'c'.repeat(64),
      caseVersion: 5,
      frozenRole: 'preparer',
      manifest: {
        caseId: CASE,
        requests: [{ id: 'r1', status: 'OPEN', version: 1 }],
        documents: [{ id: 'd1', requestId: 'r1', clientDigest: 'ab', byteSize: 10 }],
      },
    });
    expect(fake.queries[0]).toEqual({
      table: 'case_review_packages',
      filters: { ...scopeFilters, case_id: CASE, superseded_at: null },
    });
    const reviews = await r.listReviews(scope, 'pkg-1');
    expect(reviews).toEqual([
      {
        id: 'rev-1',
        reviewerRole: 'reviewer',
        status: 'RECORDED',
        verdict: 'PASS',
        note: '',
        startedAt: '2026-09-28T17:01:00Z',
        recordedAt: '2026-09-28T17:02:00Z',
      },
    ]);
    expect(fake.queries[1]?.filters).toEqual({ ...scopeFilters, package_id: 'pkg-1' });
    const approvals = await r.listApprovals(scope, 'pkg-1');
    expect(approvals[0]).toMatchObject({
      id: 'app-1',
      status: 'ACTIVE',
      destination: 'hive-record',
    });
    expect(fake.queries[2]?.filters).toEqual({ ...scopeFilters, package_id: 'pkg-1' });
  });
});

describe('ReviewRepository writes', () => {
  const base = { caseId: CASE, caseVersion: 3, idempotencyKey: 'k1' };
  const receipt = { data: { case_status: 'READY_FOR_REVIEW', case_version: 4 }, error: null };

  it('sends the exact scope, the case version, and the key to each transition', async () => {
    const fake = makeFakeClient({ rpc: () => receipt });
    const r = repo(fake.client);
    await expect(r.freeze(scope, base)).resolves.toEqual({
      caseStatus: 'READY_FOR_REVIEW',
      caseVersion: 4,
    });
    await r.startReview(scope, base);
    await r.resume(scope, base);
    await r.recordVerdict(scope, { ...base, verdict: 'RETURN', note: 'Missing page (Synthetic)' });
    await r.approve(scope, {
      ...base,
      packageId: 'pkg-1',
      packageDigest: 'c'.repeat(64),
      destination: 'hive-record',
    });
    const expectedBase = {
      p_environment_id: scope.environmentId,
      p_client_id: scope.clientId,
      p_entity_id: scope.entityId,
      p_case_id: CASE,
      p_case_version: 3,
      p_idempotency_key: 'k1',
    };
    expect(fake.rpcs.map((call) => call.name)).toEqual([
      'freeze_case_package',
      'start_case_review',
      'resume_case',
      'record_case_verdict',
      'approve_case_package',
    ]);
    expect(fake.rpcs[0]?.args).toEqual(expectedBase);
    expect(fake.rpcs[3]?.args).toEqual({
      ...expectedBase,
      p_verdict: 'RETURN',
      p_note: 'Missing page (Synthetic)',
    });
    expect(fake.rpcs[4]?.args).toEqual({
      ...expectedBase,
      p_package_id: 'pkg-1',
      p_package_digest: 'c'.repeat(64),
      p_destination: 'hive-record',
    });
  });

  it('turns a refusal token into a typed error, a denial into the safe error, and refuses a malformed receipt', async () => {
    const refused = makeFakeClient({
      rpc: () => ({ data: null, error: { code: 'P0001', message: 'conflict_of_interest' } }),
    });
    await expect(
      repo(refused.client).approve(scope, {
        ...base,
        packageId: 'p',
        packageDigest: 'd',
        destination: 'hive-record',
      }),
    ).rejects.toMatchObject({ refusal: 'conflict_of_interest' });
    const denied = makeFakeClient({
      rpc: () => ({ data: null, error: { code: '42501', message: 'staff act only at aal2' } }),
    });
    await expect(repo(denied.client).freeze(scope, base)).rejects.toMatchObject({ code: 'denied' });
    const malformed = makeFakeClient({
      rpc: () => ({ data: { case_status: 'NOPE' }, error: null }),
    });
    await expect(repo(malformed.client).freeze(scope, base)).rejects.toMatchObject({
      code: 'unknown',
    });
  });
});

describe('mapReviewError and decodeManifest', () => {
  it('recognizes every token and nothing else', () => {
    expect(mapReviewError({ code: 'P0001', message: 'digest_mismatch' })).toBeInstanceOf(
      ReviewRefusedError,
    );
    expect(mapReviewError({ code: 'P0001', message: 'something internal' })).toMatchObject({
      code: 'unknown',
    });
  });

  it('decodes a manifest defensively', () => {
    expect(decodeManifest(null)).toEqual({ caseId: '', requests: [], answers: [], documents: [] });
    expect(decodeManifest({ case_id: 'c', requests: 'nope' })).toEqual({
      caseId: 'c',
      requests: [],
      answers: [],
      documents: [],
    });
  });
});
