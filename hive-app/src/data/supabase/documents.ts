/** Documents on a request: the read surface and the controlled upload
 * path (WO-003).
 *
 * The read is a scope-bound repository exactly like requests. The upload
 * is three server round trips, each of which the server may refuse:
 *
 *   begin     -> public.begin_document_upload reserves a path in the
 *                quarantine bucket (idempotent on the key the phone made);
 *   transfer  -> one INSERT into the bucket at exactly that path, which
 *                the storage policy admits only from the reserving user;
 *   complete  -> public.complete_document_upload verifies the object is
 *                there at the declared size and moves the row into
 *                quarantine.
 *
 * A refusal arrives as a stable token in the error message (SQLSTATE
 * P0001) and becomes an UploadRefusedError the screen can word; every
 * other failure is a SafeError through the same mapper the reads use, so
 * a denied scope or an expired session behaves as it does everywhere.
 */
import { exactArrayBuffer } from '@/core/bytes';
import { SafeError } from '@/core/errors';
import type { ScopedRegistry, ScopedResource } from '@/tenancy/clearing';
import type { ScopeKey } from '@/tenancy/scope-key';

import { type ClientAccessor, mapDbError, newest, type ScopedList } from './repositories';

// Re-exported for the transfer tests, which exercise it beside the mapper.
export { exactArrayBuffer };

/** Client-visible states. UPLOADING rows are reservations, not documents,
 * and never reach a screen; the repository drops them. */
export type DocumentStatus = 'QUARANTINED' | 'VALIDATING' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED';

export const DOCUMENT_STATUSES: readonly DocumentStatus[] = [
  'QUARANTINED',
  'VALIDATING',
  'ACCEPTED',
  'REJECTED',
  'EXPIRED',
];

export interface DocumentSummary {
  id: string;
  displayName: string;
  mimeType: string;
  byteSize: number;
  status: DocumentStatus;
  receivedAt: string | null;
  checkedAt: string | null;
}

export interface DocumentsLoader {
  list(scope: ScopeKey, requestId: string): Promise<ScopedList<DocumentSummary>>;
}

export interface UploadReservation {
  uploadId: string;
  storageBucket: string;
  storagePath: string;
  status: string;
}

export interface BeginUploadInput {
  requestId: string;
  /** The request's version as the screen read it: the server refuses a
   * stale one (request_changed) rather than acting on old state. */
  requestVersion: number;
  /** Made once per attempt on the phone; a retry reuses it, so a lost
   * response can never reserve twice. */
  idempotencyKey: string;
  displayName: string;
  mimeType: string;
  byteSize: number;
  clientDigest: string;
}

export interface UploadReceipt {
  uploadId: string;
  status: string;
  receivedAt: string | null;
}

/** Every refusal token the server can answer with, verbatim. */
export const UPLOAD_REFUSALS = [
  'request_not_found',
  'request_closed',
  'request_changed',
  'unsupported_type',
  'empty_file',
  'file_too_large',
  'invalid_digest',
  'invalid_name',
  'invalid_idempotency_key',
  'too_many_documents',
  'transfer_incomplete',
  'transfer_expired',
  'size_mismatch',
] as const;

export type UploadRefusal = (typeof UPLOAD_REFUSALS)[number];

export class UploadRefusedError extends Error {
  constructor(readonly refusal: UploadRefusal) {
    // The token only; wording is the screen's, never the server's.
    super(`upload refused: ${refusal}`);
    this.name = 'UploadRefusedError';
  }
}

export interface DocumentUploader {
  begin(scope: ScopeKey, input: BeginUploadInput): Promise<UploadReservation>;
  transfer(reservation: UploadReservation, bytes: Uint8Array, mimeType: string): Promise<void>;
  complete(uploadId: string): Promise<UploadReceipt>;
}

interface RefusalShapedError {
  code?: string;
  message?: string;
}

/** A P0001 whose message is a known token is a refusal; anything else is
 * the same safe mapping the reads use. */
export function mapUploadError(error: unknown): UploadRefusedError | SafeError {
  if (error instanceof UploadRefusedError || error instanceof SafeError) return error;
  const e = (error ?? {}) as RefusalShapedError;
  if (
    e.code === 'P0001' &&
    typeof e.message === 'string' &&
    (UPLOAD_REFUSALS as readonly string[]).includes(e.message)
  ) {
    return new UploadRefusedError(e.message as UploadRefusal);
  }
  return mapDbError(error);
}

interface StorageShapedError {
  status?: number;
  statusCode?: string | number;
  message?: string;
}

/** What a failed storage INSERT means. An object already at the path is
 * a transfer that did land (the response was lost): completion verifies
 * its size, so it is reported as done here. */
export function mapTransferError(
  error: unknown,
): UploadRefusedError | SafeError | 'already_present' {
  const e = (error ?? {}) as StorageShapedError;
  const status = Number(e.status ?? e.statusCode ?? 0);
  const message = typeof e.message === 'string' ? e.message : '';
  if (status === 409 || /already exists/i.test(message)) return 'already_present';
  if (status === 413 || /exceeded|too large/i.test(message)) {
    return new UploadRefusedError('file_too_large');
  }
  if (status === 415 || /mime type .* not supported/i.test(message)) {
    return new UploadRefusedError('unsupported_type');
  }
  if (status === 401) return new SafeError('auth_expired');
  if (status === 403 || /row-level security|not authorized|unauthorized/i.test(message)) {
    return new SafeError('denied');
  }
  return mapDbError(error);
}

function decodeReservation(value: unknown): UploadReservation {
  const v = (value ?? {}) as Record<string, unknown>;
  if (
    typeof v['upload_id'] !== 'string' ||
    typeof v['storage_bucket'] !== 'string' ||
    typeof v['storage_path'] !== 'string' ||
    typeof v['status'] !== 'string'
  ) {
    throw new SafeError('unknown');
  }
  return {
    uploadId: v['upload_id'],
    storageBucket: v['storage_bucket'],
    storagePath: v['storage_path'],
    status: v['status'],
  };
}

function decodeReceipt(value: unknown): UploadReceipt {
  const v = (value ?? {}) as Record<string, unknown>;
  if (typeof v['upload_id'] !== 'string' || typeof v['status'] !== 'string') {
    throw new SafeError('unknown');
  }
  const receivedAt = v['received_at'];
  return {
    uploadId: v['upload_id'],
    status: v['status'],
    receivedAt: typeof receivedAt === 'string' ? receivedAt : null,
  };
}

function isDocumentStatus(value: string): value is DocumentStatus {
  return (DOCUMENT_STATUSES as readonly string[]).includes(value);
}

export class DocumentsRepository implements ScopedResource, DocumentsLoader, DocumentUploader {
  private unregister: () => void;

  constructor(
    private readonly getClient: ClientAccessor,
    registry: ScopedRegistry,
  ) {
    this.unregister = registry.register(this);
  }

  clear(): void {
    // No cached state: bytes live only for the duration of one transfer.
  }

  dispose(): void {
    this.unregister();
  }

  /** The documents on one request, newest first. The request id is a
   * filter inside the scope, never scope (threat T5), and the read carries
   * the full scope triple on top of RLS exactly like every other read. */
  async list(scope: ScopeKey, requestId: string): Promise<ScopedList<DocumentSummary>> {
    const client = this.getClient();
    try {
      const result = await client
        .from('document_uploads')
        .select(
          'id, display_name, mime_type, byte_size, status, received_at, checked_at, created_at',
        )
        .eq('environment_id', scope.environmentId)
        .eq('client_id', scope.clientId)
        .eq('entity_id', scope.entityId)
        .eq('request_id', requestId)
        .order('created_at', { ascending: false });
      if (result.error) throw result.error;
      const items: DocumentSummary[] = [];
      for (const row of result.data) {
        // A reservation is not a document until the transfer completes.
        if (!isDocumentStatus(row.status)) continue;
        items.push({
          id: row.id,
          displayName: row.display_name,
          mimeType: row.mime_type,
          byteSize: row.byte_size,
          status: row.status,
          receivedAt: row.received_at,
          checkedAt: row.checked_at,
        });
      }
      return {
        items,
        recordedThrough: newest(items.flatMap((item) => [item.receivedAt, item.checkedAt])),
      };
    } catch (error) {
      throw mapDbError(error);
    }
  }

  async begin(scope: ScopeKey, input: BeginUploadInput): Promise<UploadReservation> {
    const client = this.getClient();
    try {
      const result = await client.rpc('begin_document_upload', {
        p_environment_id: scope.environmentId,
        p_client_id: scope.clientId,
        p_entity_id: scope.entityId,
        p_request_id: input.requestId,
        p_request_version: input.requestVersion,
        p_idempotency_key: input.idempotencyKey,
        p_display_name: input.displayName,
        p_mime_type: input.mimeType,
        p_byte_size: input.byteSize,
        p_client_digest: input.clientDigest,
      });
      if (result.error) throw result.error;
      return decodeReservation(result.data);
    } catch (error) {
      throw mapUploadError(error);
    }
  }

  async transfer(
    reservation: UploadReservation,
    bytes: Uint8Array,
    mimeType: string,
  ): Promise<void> {
    const client = this.getClient();
    let outcome: { error: unknown } | undefined;
    try {
      // An ArrayBuffer body is the path the pinned storage-js documents for
      // React Native; Blob and FormData "do not work as intended" there.
      outcome = await client.storage
        .from(reservation.storageBucket)
        .upload(reservation.storagePath, exactArrayBuffer(bytes), {
          contentType: mimeType,
          upsert: false,
          cacheControl: '0',
        });
    } catch (error) {
      throw mapTransferError(error) === 'already_present'
        ? new SafeError('unknown')
        : mapDbError(error);
    }
    if (outcome.error) {
      const mapped = mapTransferError(outcome.error);
      if (mapped !== 'already_present') throw mapped;
    }
  }

  async complete(uploadId: string): Promise<UploadReceipt> {
    const client = this.getClient();
    try {
      const result = await client.rpc('complete_document_upload', { p_upload_id: uploadId });
      if (result.error) throw result.error;
      return decodeReceipt(result.data);
    } catch (error) {
      throw mapUploadError(error);
    }
  }
}
