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

describe('ReviewRepository sources and record (WO-006)', () => {
  it('reads the ledger references and filing receipts inside the full scope, the case id a filter, and drops rows it cannot name', async () => {
    const fake = makeFakeClient({
      rowsByTable: {
        ledger_references: [
          {
            id: 'ref-1',
            source: 'qbo',
            realm_id: 'realm-synthetic-a1',
            object_type: 'Account',
            object_id: 'acct-synthetic-operating',
            object_version: '3',
            display_name: 'Operating account (Synthetic)',
            as_of: '2026-09-28T12:00:00Z',
            object_digest: 'a'.repeat(64),
            adapter_name: 'HiveSyntheticLedger',
            recorded_at: '2026-09-28T12:05:00Z',
          },
        ],
        filing_receipts: [
          {
            id: 'rcpt-1',
            document_id: 'd1',
            package_id: 'pkg-1',
            drive_file_id: 'drv-synthetic-0001',
            drive_path: '/Clients/Harbor Light Bakery LLC (Synthetic)',
            claimed_digest: 'b'.repeat(64),
            filed_role: 'intake',
            filed_at: '2026-09-28T18:00:00Z',
            status: 'RECORDED',
            verified_at: null,
            found_digest: null,
            adapter_name: null,
          },
          {
            id: 'rcpt-x',
            document_id: 'd1',
            package_id: 'pkg-1',
            drive_file_id: 'x',
            drive_path: 'p',
            claimed_digest: 'b'.repeat(64),
            filed_role: 'intake',
            filed_at: '2026-09-28T18:00:00Z',
            status: 'SOMETHING_ELSE',
            verified_at: null,
            found_digest: null,
            adapter_name: null,
          },
        ],
      },
    });
    const r = repo(fake.client);
    await expect(r.listLedgerReferences(scope, CASE)).resolves.toEqual([
      {
        id: 'ref-1',
        source: 'qbo',
        realmId: 'realm-synthetic-a1',
        objectType: 'Account',
        objectId: 'acct-synthetic-operating',
        objectVersion: '3',
        displayName: 'Operating account (Synthetic)',
        asOf: '2026-09-28T12:00:00Z',
        objectDigest: 'a'.repeat(64),
        adapterName: 'HiveSyntheticLedger',
        recordedAt: '2026-09-28T12:05:00Z',
      },
    ]);
    await expect(r.listFilingReceipts(scope, CASE)).resolves.toEqual([
      {
        id: 'rcpt-1',
        documentId: 'd1',
        packageId: 'pkg-1',
        driveFileId: 'drv-synthetic-0001',
        drivePath: '/Clients/Harbor Light Bakery LLC (Synthetic)',
        claimedDigest: 'b'.repeat(64),
        filedRole: 'intake',
        filedAt: '2026-09-28T18:00:00Z',
        status: 'RECORDED',
        verifiedAt: null,
        foundDigest: null,
        adapterName: null,
      },
    ]);
    expect(fake.queries.map((query) => query.table)).toEqual([
      'ledger_references',
      'filing_receipts',
    ]);
    for (const query of fake.queries) {
      expect(query.filters).toEqual({ ...scopeFilters, case_id: CASE });
    }
  });

  it('records a filing receipt with the exact scope, case version, key, document, and Drive object, and decodes the record', async () => {
    const input = {
      caseId: CASE,
      caseVersion: 9,
      idempotencyKey: 'k9',
      documentId: 'd1',
      driveFileId: 'drv-synthetic-0001',
      drivePath: '/Clients/Harbor Light Bakery LLC (Synthetic)',
    };
    const fake = makeFakeClient({
      rpc: () => ({
        data: {
          receipt_id: 'rcpt-1',
          status: 'RECORDED',
          claimed_digest: 'b'.repeat(64),
          package_id: 'pkg-1',
          case_version: 9,
        },
        error: null,
      }),
    });
    await expect(repo(fake.client).recordFiling(scope, input)).resolves.toEqual({
      receiptId: 'rcpt-1',
      status: 'RECORDED',
      claimedDigest: 'b'.repeat(64),
      packageId: 'pkg-1',
      caseVersion: 9,
    });
    expect(fake.rpcs).toEqual([
      {
        name: 'record_filing_receipt',
        args: {
          p_environment_id: scope.environmentId,
          p_client_id: scope.clientId,
          p_entity_id: scope.entityId,
          p_case_id: CASE,
          p_case_version: 9,
          p_idempotency_key: 'k9',
          p_document_id: 'd1',
          p_drive_file_id: 'drv-synthetic-0001',
          p_drive_path: '/Clients/Harbor Light Bakery LLC (Synthetic)',
        },
      },
    ]);
    const refused = makeFakeClient({
      rpc: () => ({ data: null, error: { code: 'P0001', message: 'document_not_approved' } }),
    });
    await expect(repo(refused.client).recordFiling(scope, input)).rejects.toMatchObject({
      refusal: 'document_not_approved',
    });
    const malformed = makeFakeClient({
      rpc: () => ({ data: { receipt_id: 'r', status: 'RECORDED' }, error: null }),
    });
    await expect(repo(malformed.client).recordFiling(scope, input)).rejects.toMatchObject({
      code: 'unknown',
    });
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
