import { SafeError } from '@/core/errors';
import { ScopedRegistry } from '@/tenancy/clearing';
import type { ScopeKey } from '@/tenancy/scope-key';

import {
  DocumentsRepository,
  UploadRefusedError,
  exactArrayBuffer,
  mapTransferError,
  mapUploadError,
} from '../documents';

const scope = {
  environmentId: '11111111-0000-4000-8000-000000000001',
  clientId: 'aaaaaaaa-0000-4000-8000-000000000001',
  entityId: 'aaaaaaaa-1111-4000-8000-000000000001',
  membershipId: 'mmmmmmmm-0000-4000-8000-000000000001',
} as unknown as ScopeKey;

const REQUEST = 'dddddddd-0000-4000-8000-0000000000a1';

interface RecordedQuery {
  table: string;
  filters: Record<string, string>;
  order: { column: string; ascending: boolean } | null;
}

interface RecordedRpc {
  name: string;
  args: Record<string, unknown>;
}

interface RecordedUpload {
  bucket: string;
  path: string;
  body: ArrayBuffer;
  options: Record<string, unknown>;
}

/** A PostgREST-and-storage-shaped double that records exactly what was
 * asked and answers with what the test scripted. */
function makeFakeClient(script: {
  rows?: unknown[];
  rpc?: (name: string, args: Record<string, unknown>) => { data: unknown; error: unknown };
  upload?: (upload: RecordedUpload) => { error: unknown };
}) {
  const queries: RecordedQuery[] = [];
  const rpcs: RecordedRpc[] = [];
  const uploads: RecordedUpload[] = [];
  const client = {
    from(table: string) {
      const record: RecordedQuery = { table, filters: {}, order: null };
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
        limit: () => builder,
        then: (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
          resolve({ data: script.rows ?? [], error: null }),
      };
      return builder;
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcs.push({ name, args });
      return script.rpc ? script.rpc(name, args) : { data: null, error: null };
    },
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string, body: ArrayBuffer, options: Record<string, unknown>) => {
          const upload = { bucket, path, body, options };
          uploads.push(upload);
          return script.upload ? script.upload(upload) : { data: { path }, error: null };
        },
      }),
    },
  };
  return { client, queries, rpcs, uploads };
}

function repo(client: unknown): DocumentsRepository {
  return new DocumentsRepository(() => client as never, new ScopedRegistry());
}

describe('DocumentsRepository.list', () => {
  it('filters by the full scope triple plus the request id, newest first', async () => {
    const fake = makeFakeClient({});
    await repo(fake.client).list(scope, REQUEST);
    expect(fake.queries[0]?.table).toBe('document_uploads');
    expect(fake.queries[0]?.filters).toEqual({
      environment_id: scope.environmentId,
      client_id: scope.clientId,
      entity_id: scope.entityId,
      request_id: REQUEST,
    });
    expect(fake.queries[0]?.order).toEqual({ column: 'created_at', ascending: false });
  });

  it('shows received and settled documents and never a bare reservation', async () => {
    const fake = makeFakeClient({
      rows: [
        {
          id: 'u1',
          display_name: 'a (Synthetic).pdf',
          mime_type: 'application/pdf',
          byte_size: 10,
          status: 'UPLOADING',
          received_at: null,
          checked_at: null,
          created_at: '2026-09-28T10:00:00Z',
        },
        {
          id: 'u2',
          display_name: 'b (Synthetic).pdf',
          mime_type: 'application/pdf',
          byte_size: 20,
          status: 'QUARANTINED',
          received_at: '2026-09-27T10:00:00Z',
          checked_at: null,
          created_at: '2026-09-27T09:59:00Z',
        },
        {
          id: 'u3',
          display_name: 'c (Synthetic).csv',
          mime_type: 'text/csv',
          byte_size: 30,
          status: 'ACCEPTED',
          received_at: '2026-09-20T10:00:00Z',
          checked_at: '2026-09-20T10:05:00Z',
          created_at: '2026-09-20T09:59:00Z',
        },
      ],
    });
    const list = await repo(fake.client).list(scope, REQUEST);
    expect(list.items.map((item) => item.id)).toEqual(['u2', 'u3']);
    expect(list.items[0]).toEqual({
      id: 'u2',
      displayName: 'b (Synthetic).pdf',
      mimeType: 'application/pdf',
      byteSize: 20,
      status: 'QUARANTINED',
      receivedAt: '2026-09-27T10:00:00Z',
      checkedAt: null,
    });
    // The newest SERVER timestamp present, across received and checked.
    expect(list.recordedThrough).toBe('2026-09-27T10:00:00Z');
  });

  it('maps a denial to the safe denied error', async () => {
    const client = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  order: async () => ({ data: null, error: { code: '42501' } }),
                }),
              }),
            }),
          }),
        }),
      }),
    };
    await expect(repo(client).list(scope, REQUEST)).rejects.toMatchObject({ code: 'denied' });
  });
});

describe('DocumentsRepository upload path', () => {
  const input = {
    requestId: REQUEST,
    requestVersion: 1,
    idempotencyKey: 'aaaa1111-0000-4000-8000-000000000001',
    displayName: 'statement (Synthetic).pdf',
    mimeType: 'application/pdf',
    byteSize: 1234,
    clientDigest: 'ab'.repeat(32),
  };
  const reservation = {
    upload_id: '42f0c366-9dcd-4243-b08a-5d60ecde3e90',
    storage_bucket: 'hive-quarantine',
    storage_path: 'env/client/entity/request/42f0c366-9dcd-4243-b08a-5d60ecde3e90',
    status: 'UPLOADING',
    expires_at: '2026-09-29T14:51:33Z',
  };

  it('begin sends the exact scope, the request version, and the phone-made key', async () => {
    const fake = makeFakeClient({ rpc: () => ({ data: reservation, error: null }) });
    const result = await repo(fake.client).begin(scope, input);
    expect(fake.rpcs[0]?.name).toBe('begin_document_upload');
    expect(fake.rpcs[0]?.args).toEqual({
      p_environment_id: scope.environmentId,
      p_client_id: scope.clientId,
      p_entity_id: scope.entityId,
      p_request_id: REQUEST,
      p_request_version: 1,
      p_idempotency_key: input.idempotencyKey,
      p_display_name: input.displayName,
      p_mime_type: 'application/pdf',
      p_byte_size: 1234,
      p_client_digest: 'ab'.repeat(32),
    });
    expect(result).toEqual({
      uploadId: reservation.upload_id,
      storageBucket: 'hive-quarantine',
      storagePath: reservation.storage_path,
      status: 'UPLOADING',
    });
  });

  it('turns a server refusal token into an UploadRefusedError the screen can word', async () => {
    const fake = makeFakeClient({
      rpc: () => ({ data: null, error: { code: 'P0001', message: 'request_closed' } }),
    });
    await expect(repo(fake.client).begin(scope, input)).rejects.toBeInstanceOf(UploadRefusedError);
    await expect(repo(fake.client).begin(scope, input)).rejects.toMatchObject({
      refusal: 'request_closed',
    });
  });

  it('keeps authorization failures as the safe denied error, never a refusal', async () => {
    const fake = makeFakeClient({
      rpc: () => ({ data: null, error: { code: '42501', message: 'no client membership' } }),
    });
    await expect(repo(fake.client).begin(scope, input)).rejects.toMatchObject({ code: 'denied' });
  });

  it('refuses a malformed reservation rather than uploading to an unknown place', async () => {
    const fake = makeFakeClient({ rpc: () => ({ data: { upload_id: 'x' }, error: null }) });
    await expect(repo(fake.client).begin(scope, input)).rejects.toMatchObject({ code: 'unknown' });
  });

  it('transfer inserts the exact bytes at the reserved path with the declared type, never upserting', async () => {
    const fake = makeFakeClient({});
    const bytes = new Uint8Array([1, 2, 3, 4]);
    await repo(fake.client).transfer(
      {
        uploadId: reservation.upload_id,
        storageBucket: 'hive-quarantine',
        storagePath: reservation.storage_path,
        status: 'UPLOADING',
      },
      bytes,
      'application/pdf',
    );
    expect(fake.uploads[0]?.bucket).toBe('hive-quarantine');
    expect(fake.uploads[0]?.path).toBe(reservation.storage_path);
    expect(Array.from(new Uint8Array(fake.uploads[0]!.body))).toEqual([1, 2, 3, 4]);
    expect(fake.uploads[0]?.options).toEqual({
      contentType: 'application/pdf',
      upsert: false,
      cacheControl: '0',
    });
  });

  it('treats an object already at the path as a transfer that landed', async () => {
    const fake = makeFakeClient({
      upload: () => ({ error: { status: 409, message: 'The resource already exists' } }),
    });
    await expect(
      repo(fake.client).transfer(
        { uploadId: 'u', storageBucket: 'b', storagePath: 'p', status: 'UPLOADING' },
        new Uint8Array([1]),
        'text/csv',
      ),
    ).resolves.toBeUndefined();
  });

  it('complete asks the server to verify the object and returns its receipt', async () => {
    const fake = makeFakeClient({
      rpc: () => ({
        data: { upload_id: 'u', status: 'QUARANTINED', received_at: '2026-09-28T15:00:00Z' },
        error: null,
      }),
    });
    const receipt = await repo(fake.client).complete('u');
    expect(fake.rpcs[0]).toEqual({ name: 'complete_document_upload', args: { p_upload_id: 'u' } });
    expect(receipt).toEqual({
      uploadId: 'u',
      status: 'QUARANTINED',
      receivedAt: '2026-09-28T15:00:00Z',
    });
  });
});

describe('error mapping', () => {
  it('recognizes every refusal token and nothing else', () => {
    expect(mapUploadError({ code: 'P0001', message: 'too_many_documents' })).toMatchObject({
      refusal: 'too_many_documents',
    });
    // A P0001 with an unknown message is not a refusal the app may word.
    expect(mapUploadError({ code: 'P0001', message: 'something internal' })).toMatchObject({
      code: 'unknown',
    });
    expect(mapUploadError({ code: 'PGRST301', message: 'JWT expired' })).toMatchObject({
      code: 'auth_expired',
    });
    expect(mapUploadError(new SafeError('offline')).message).toBe(new SafeError('offline').message);
  });

  it('maps storage refusals to the same vocabulary', () => {
    expect(mapTransferError({ status: 413, message: 'Payload too large' })).toMatchObject({
      refusal: 'file_too_large',
    });
    expect(
      mapTransferError({ statusCode: '415', message: 'mime type x is not supported' }),
    ).toMatchObject({
      refusal: 'unsupported_type',
    });
    expect(
      mapTransferError({ status: 403, message: 'new row violates row-level security' }),
    ).toMatchObject({
      code: 'denied',
    });
    expect(mapTransferError({ status: 409, message: 'already exists' })).toBe('already_present');
    expect(mapTransferError(new TypeError('Network request failed'))).toMatchObject({
      code: 'network',
    });
  });

  it('sends exactly the view, not the allocation it sits in', () => {
    const backing = new Uint8Array([9, 9, 1, 2, 3, 9]);
    const view = backing.subarray(2, 5);
    expect(Array.from(new Uint8Array(exactArrayBuffer(view)))).toEqual([1, 2, 3]);
    const whole = new Uint8Array([4, 5]);
    expect(exactArrayBuffer(whole)).toBe(whole.buffer);
  });
});

describe('DocumentsRepository.getById (WO-004)', () => {
  it('reads one document by id inside the full scope, and never a bare reservation', async () => {
    const fake = makeFakeClient({
      rows: [
        {
          id: 'd0c0d0c0-0000-4000-8000-0000000000a3',
          display_name: 'statement-2025-11 (Synthetic).pdf',
          mime_type: 'application/pdf',
          byte_size: 96256,
          status: 'ACCEPTED',
          received_at: '2026-08-06T14:00:00Z',
          checked_at: '2026-08-06T14:03:00Z',
        },
      ],
    });
    const found = await repo(fake.client).getById(scope, 'd0c0d0c0-0000-4000-8000-0000000000a3');
    expect(found).toMatchObject({ id: 'd0c0d0c0-0000-4000-8000-0000000000a3', status: 'ACCEPTED' });
    expect(fake.queries[0]?.filters).toEqual({
      environment_id: scope.environmentId,
      client_id: scope.clientId,
      entity_id: scope.entityId,
      id: 'd0c0d0c0-0000-4000-8000-0000000000a3',
    });

    const reservation = makeFakeClient({
      rows: [
        {
          id: 'u1',
          display_name: 'x',
          mime_type: 'application/pdf',
          byte_size: 1,
          status: 'UPLOADING',
          received_at: null,
          checked_at: null,
        },
      ],
    });
    await expect(repo(reservation.client).getById(scope, 'u1')).resolves.toBeNull();
    await expect(repo(makeFakeClient({}).client).getById(scope, 'missing')).resolves.toBeNull();
  });
});
