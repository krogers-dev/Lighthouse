import { SafeError } from '@/core/errors';

import { ScopedRegistry } from '@/tenancy/clearing';
import type { ScopeKey } from '@/tenancy/scope-key';

import {
  ACTIVITY_WINDOW,
  ActivityRepository,
  RequestsRepository,
  mapDbError,
} from '../repositories';

describe('mapDbError', () => {
  it('maps expired-JWT signals to auth_expired', () => {
    expect(mapDbError({ code: 'PGRST301', message: 'JWT expired' }).code).toBe('auth_expired');
    expect(mapDbError({ status: 401, message: 'Unauthorized' }).code).toBe('auth_expired');
  });

  it('maps privilege denials to denied', () => {
    expect(mapDbError({ code: '42501', message: 'permission denied for table cases' }).code).toBe(
      'denied',
    );
    expect(mapDbError({ status: 403 }).code).toBe('denied');
  });

  it('maps transport failures to network', () => {
    expect(mapDbError(new TypeError('Network request failed')).code).toBe('network');
  });

  it('never leaks database internals into user messages', () => {
    const mapped = mapDbError({ code: 'XX000', message: 'relation secret_internal_table broke' });
    expect(mapped.code).toBe('unknown');
    expect(mapped.userMessage).not.toContain('secret_internal_table');
  });

  it('passes SafeError through', () => {
    const original = new SafeError('offline');
    expect(mapDbError(original)).toBe(original);
  });
});

// ---------------------------------------------------------------------------
// Milestone 1 read surfaces: every query carries the full scope triple as
// defense in depth on top of RLS, and a route id is only ever a filter.
// ---------------------------------------------------------------------------

const scope = {
  environmentId: '11111111-0000-4000-8000-000000000001',
  clientId: 'aaaaaaaa-0000-4000-8000-000000000001',
  entityId: 'aaaaaaaa-1111-4000-8000-000000000001',
  membershipId: 'mmmmmmmm-0000-4000-8000-000000000001',
} as unknown as ScopeKey;

interface RecordedQuery {
  table: string;
  filters: Record<string, string>;
  limit: number | null;
  order: { column: string; ascending: boolean } | null;
}

/** Minimal PostgREST-shaped double that records exactly what was asked. */
function makeRecordingClient(rows: unknown[]) {
  const queries: RecordedQuery[] = [];
  const client = {
    from(table: string) {
      const record: RecordedQuery = { table, filters: {}, limit: null, order: null };
      queries.push(record);
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: (column: string, value: string) => {
          record.filters[column] = value;
          return builder;
        },
        order: (column: string, options: { ascending: boolean }) => {
          record.order = { column, ascending: options.ascending };
          return builder;
        },
        limit: (n: number) => {
          record.limit = n;
          return builder;
        },
        then: (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
          resolve({ data: rows, error: null }),
      };
      return builder;
    },
  };
  return { client, queries };
}

describe('RequestsRepository', () => {
  it('filters every list read by the full scope triple', async () => {
    const { client, queries } = makeRecordingClient([]);
    const repo = new RequestsRepository(() => client as never, new ScopedRegistry());
    await repo.list(scope);
    expect(queries[0]?.table).toBe('requests');
    expect(queries[0]?.filters).toEqual({
      environment_id: scope.environmentId,
      client_id: scope.clientId,
      entity_id: scope.entityId,
    });
  });

  it('treats a request id as a FILTER inside the scope, never as scope (T5)', async () => {
    const { client, queries } = makeRecordingClient([]);
    const repo = new RequestsRepository(() => client as never, new ScopedRegistry());
    const found = await repo.get(scope, 'some-foreign-id');
    // Scope filters are still present alongside the id filter.
    expect(queries[0]?.filters).toEqual({
      environment_id: scope.environmentId,
      client_id: scope.clientId,
      entity_id: scope.entityId,
      id: 'some-foreign-id',
    });
    // No row: null, not an error that would confirm the id exists.
    expect(found).toBeNull();
  });

  it('reports the newest server timestamp present, and null when there is none', async () => {
    const rows = [
      {
        id: 'a',
        title: 't',
        status: 'OPEN',
        owner_role: 'client_user',
        requested_on: '2026-08-05',
        due_on: null,
      },
      {
        id: 'b',
        title: 't2',
        status: 'OPEN',
        owner_role: 'client_user',
        requested_on: '2026-08-10',
        due_on: null,
      },
    ];
    const populated = makeRecordingClient(rows);
    const withRows = new RequestsRepository(() => populated.client as never, new ScopedRegistry());
    await expect(withRows.list(scope)).resolves.toMatchObject({
      recordedThrough: '2026-08-10',
    });

    const empty = makeRecordingClient([]);
    const withoutRows = new RequestsRepository(() => empty.client as never, new ScopedRegistry());
    await expect(withoutRows.list(scope)).resolves.toMatchObject({ recordedThrough: null });
  });
});

describe('ActivityRepository', () => {
  it('filters by the full scope triple and reads a bounded, newest-first window', async () => {
    const { client, queries } = makeRecordingClient([]);
    const repo = new ActivityRepository(() => client as never, new ScopedRegistry());
    await repo.list(scope);
    expect(queries[0]?.table).toBe('activity_events');
    expect(queries[0]?.filters).toEqual({
      environment_id: scope.environmentId,
      client_id: scope.clientId,
      entity_id: scope.entityId,
    });
    expect(queries[0]?.order).toEqual({ column: 'occurred_at', ascending: false });
    // Bounded: never an unbounded scan of the trail.
    expect(queries[0]?.limit).toBe(ACTIVITY_WINDOW);
  });
});
