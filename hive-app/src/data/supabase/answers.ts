/** A request's answer: the read and the two reviewed writes (WO-004).
 *
 * One answer per request, kept on the server as a DRAFT until an explicit
 * submission settles it as SUBMITTED. The read is a scope-bound
 * repository like every other; the writes are two server functions:
 *
 *   saveDraft -> public.save_request_answer_draft: the request's object
 *                version, the answer's version (null for the first save),
 *                the text, and the cited documents, all checked server-side;
 *   submit    -> public.submit_request_answer: the answer's version and an
 *                idempotency key the phone made once per confirmation.
 *
 * A refusal arrives as a stable token (SQLSTATE P0001) and becomes an
 * AnswerRefusedError the screen words; everything else is a SafeError
 * through the same mapper the reads use.
 */
import { SafeError } from '@/core/errors';
import type { ScopedRegistry, ScopedResource } from '@/tenancy/clearing';
import type { ScopeKey } from '@/tenancy/scope-key';

import { type ClientAccessor, mapDbError } from './repositories';

export type AnswerStatus = 'DRAFT' | 'SUBMITTED';

export interface RequestAnswer {
  id: string;
  requestId: string;
  status: AnswerStatus;
  body: string;
  version: number;
  citedDocumentIds: readonly string[];
  submittedAt: string | null;
  updatedAt: string;
}

export interface AnswerLoader {
  get(scope: ScopeKey, requestId: string): Promise<RequestAnswer | null>;
}

export interface SaveDraftInput {
  requestId: string;
  /** The request's version as the screen read it (request_changed on a
   * stale one). */
  requestVersion: number;
  body: string;
  citedDocumentIds: readonly string[];
  /** The draft's version as the screen read it; null when no draft exists
   * yet. A mismatch is answer_changed: the draft moved on another device. */
  answerVersion: number | null;
}

export interface DraftReceipt {
  answerId: string;
  status: AnswerStatus;
  version: number;
  updatedAt: string;
}

export interface SubmitInput {
  answerId: string;
  answerVersion: number;
  /** Made once per confirmation on the phone; a retry reuses it, so a lost
   * response can never submit twice or refuse the same submission. */
  idempotencyKey: string;
}

export interface SubmitReceipt {
  answerId: string;
  status: AnswerStatus;
  version: number;
  submittedAt: string | null;
}

/** Every refusal token the server can answer with, verbatim. */
export const ANSWER_REFUSALS = [
  'request_not_found',
  'request_closed',
  'request_changed',
  'invalid_text',
  'answer_too_long',
  'too_many_citations',
  'invalid_document',
  'already_submitted',
  'answer_changed',
  'empty_answer',
  'invalid_idempotency_key',
] as const;

export type AnswerRefusal = (typeof ANSWER_REFUSALS)[number];

export class AnswerRefusedError extends Error {
  constructor(readonly refusal: AnswerRefusal) {
    super(`answer refused: ${refusal}`);
    this.name = 'AnswerRefusedError';
  }
}

export interface AnswerWriter {
  saveDraft(scope: ScopeKey, input: SaveDraftInput): Promise<DraftReceipt>;
  submit(input: SubmitInput): Promise<SubmitReceipt>;
}

interface RefusalShapedError {
  code?: string;
  message?: string;
}

export function mapAnswerError(error: unknown): AnswerRefusedError | SafeError {
  if (error instanceof AnswerRefusedError || error instanceof SafeError) return error;
  const e = (error ?? {}) as RefusalShapedError;
  if (
    e.code === 'P0001' &&
    typeof e.message === 'string' &&
    (ANSWER_REFUSALS as readonly string[]).includes(e.message)
  ) {
    return new AnswerRefusedError(e.message as AnswerRefusal);
  }
  return mapDbError(error);
}

function isAnswerStatus(value: string): value is AnswerStatus {
  return value === 'DRAFT' || value === 'SUBMITTED';
}

function decodeDraftReceipt(value: unknown): DraftReceipt {
  const v = (value ?? {}) as Record<string, unknown>;
  if (
    typeof v['answer_id'] !== 'string' ||
    typeof v['status'] !== 'string' ||
    !isAnswerStatus(v['status']) ||
    typeof v['version'] !== 'number' ||
    typeof v['updated_at'] !== 'string'
  ) {
    throw new SafeError('unknown');
  }
  return {
    answerId: v['answer_id'],
    status: v['status'],
    version: v['version'],
    updatedAt: v['updated_at'],
  };
}

function decodeSubmitReceipt(value: unknown): SubmitReceipt {
  const v = (value ?? {}) as Record<string, unknown>;
  if (
    typeof v['answer_id'] !== 'string' ||
    typeof v['status'] !== 'string' ||
    !isAnswerStatus(v['status']) ||
    typeof v['version'] !== 'number'
  ) {
    throw new SafeError('unknown');
  }
  const submittedAt = v['submitted_at'];
  return {
    answerId: v['answer_id'],
    status: v['status'],
    version: v['version'],
    submittedAt: typeof submittedAt === 'string' ? submittedAt : null,
  };
}

export class AnswersRepository implements ScopedResource, AnswerLoader, AnswerWriter {
  private unregister: () => void;

  constructor(
    private readonly getClient: ClientAccessor,
    registry: ScopedRegistry,
  ) {
    this.unregister = registry.register(this);
  }

  clear(): void {
    // No cached state: the draft lives on the server, never on the device.
  }

  dispose(): void {
    this.unregister();
  }

  /** The answer on one request, with its citations. The request id is a
   * filter inside the scope, never scope (threat T5); a request without an
   * answer, or a foreign one, is null. */
  async get(scope: ScopeKey, requestId: string): Promise<RequestAnswer | null> {
    const client = this.getClient();
    try {
      const answers = await client
        .from('request_answers')
        .select('id, request_id, status, body, version, submitted_at, updated_at')
        .eq('environment_id', scope.environmentId)
        .eq('client_id', scope.clientId)
        .eq('entity_id', scope.entityId)
        .eq('request_id', requestId)
        .limit(1);
      if (answers.error) throw answers.error;
      const row = answers.data[0];
      if (!row || !isAnswerStatus(row.status)) return null;
      const citations = await client
        .from('request_answer_citations')
        .select('document_id')
        .eq('environment_id', scope.environmentId)
        .eq('client_id', scope.clientId)
        .eq('entity_id', scope.entityId)
        .eq('answer_id', row.id)
        .order('created_at', { ascending: true });
      if (citations.error) throw citations.error;
      return {
        id: row.id,
        requestId: row.request_id,
        status: row.status,
        body: row.body,
        version: row.version,
        citedDocumentIds: citations.data.map((citation) => citation.document_id),
        submittedAt: row.submitted_at,
        updatedAt: row.updated_at,
      };
    } catch (error) {
      throw mapDbError(error);
    }
  }

  async saveDraft(scope: ScopeKey, input: SaveDraftInput): Promise<DraftReceipt> {
    const client = this.getClient();
    try {
      const result = await client.rpc('save_request_answer_draft', {
        p_environment_id: scope.environmentId,
        p_client_id: scope.clientId,
        p_entity_id: scope.entityId,
        p_request_id: input.requestId,
        p_request_version: input.requestVersion,
        p_body: input.body,
        p_cited_document_ids: [...input.citedDocumentIds],
        ...(input.answerVersion === null ? {} : { p_answer_version: input.answerVersion }),
      });
      if (result.error) throw result.error;
      return decodeDraftReceipt(result.data);
    } catch (error) {
      throw mapAnswerError(error);
    }
  }

  async submit(input: SubmitInput): Promise<SubmitReceipt> {
    const client = this.getClient();
    try {
      const result = await client.rpc('submit_request_answer', {
        p_answer_id: input.answerId,
        p_answer_version: input.answerVersion,
        p_idempotency_key: input.idempotencyKey,
      });
      if (result.error) throw result.error;
      return decodeSubmitReceipt(result.data);
    } catch (error) {
      throw mapAnswerError(error);
    }
  }
}
