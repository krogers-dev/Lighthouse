/** The case workflow for staff: the frozen package, the verdicts, the
 * approvals, the five reviewed transitions (WO-005), and the case's
 * sources: read-only ledger references and the receipts of manual filing
 * to the permanent record (WO-006).
 *
 * Reads are scope-bound repositories like every other, on tables only
 * staff of the scope can read at AAL2. Writes are the server functions
 * of Milestones 4 and 5, each under the protected-mutation contract:
 * the exact scope, the case's version as the screen read it, an
 * idempotency key the phone made once per confirmation, and, for an
 * approval, the exact package id and digest the screen showed. A refusal
 * arrives as a stable token (SQLSTATE P0001) and becomes a
 * ReviewRefusedError the screen words; everything else is a SafeError.
 * Ledger references and verifications are the adapters' to write, never
 * the app's.
 */
import { SafeError } from '@/core/errors';
import type { ScopedRegistry, ScopedResource } from '@/tenancy/clearing';
import type { ScopeKey } from '@/tenancy/scope-key';
import type { MembershipRole } from '@/tenancy/types';

import { type CaseStatus, type ClientAccessor, mapDbError } from './repositories';

export interface CaseRecord {
  id: string;
  title: string;
  status: CaseStatus;
  statusChangedAt: string;
  version: number;
}

/** What the package froze: ids, statuses, versions, digests, and sizes.
 * Never a name or a text. */
export interface PackageManifest {
  caseId: string;
  requests: readonly { id: string; status: string; version: number }[];
  answers: readonly { id: string; requestId: string; version: number; bodySha256: string }[];
  documents: readonly { id: string; requestId: string; clientDigest: string; byteSize: number }[];
}

export interface ReviewPackage {
  id: string;
  packageNumber: number;
  manifest: PackageManifest;
  manifestDigest: string;
  caseVersion: number;
  frozenRole: MembershipRole;
  frozenAt: string;
}

export type ReviewVerdict = 'PASS' | 'RETURN' | 'HOLD';
export type ReviewRole = 'reviewer' | 'approver';

export interface CaseReview {
  id: string;
  reviewerRole: ReviewRole;
  status: 'IN_PROGRESS' | 'RECORDED';
  verdict: ReviewVerdict | null;
  note: string;
  startedAt: string;
  recordedAt: string | null;
}

export type ApprovalStatus = 'ACTIVE' | 'EXPIRED' | 'SUPERSEDED';

export interface CaseApproval {
  id: string;
  status: ApprovalStatus;
  packageNumber: number;
  packageDigest: string;
  destination: string;
  approvedAt: string;
  expiresAt: string;
  endedAt: string | null;
  endReason: string | null;
}

/** A read-only pointer into the ledger, as the adapter read it: an
 * identifier, a version, a label, an as-of time, and a digest. Never a
 * value. */
export interface LedgerReference {
  id: string;
  source: string;
  realmId: string;
  objectType: string;
  objectId: string;
  objectVersion: string;
  displayName: string;
  asOf: string;
  objectDigest: string;
  adapterName: string;
  recordedAt: string;
}

export type FilingStatus = 'RECORDED' | 'VERIFIED' | 'MISMATCH';
export type FilingRole = 'intake' | 'preparer';

/** A person filed a checked, approved document to the record by hand;
 * the adapter then checked, read-only, that the record holds those bytes. */
export interface FilingReceipt {
  id: string;
  documentId: string;
  packageId: string;
  driveFileId: string;
  drivePath: string;
  claimedDigest: string;
  filedRole: FilingRole;
  filedAt: string;
  status: FilingStatus;
  verifiedAt: string | null;
  foundDigest: string | null;
  adapterName: string | null;
}

export interface ReviewLoader {
  getCase(scope: ScopeKey, caseId: string): Promise<CaseRecord | null>;
  getCurrentPackage(scope: ScopeKey, caseId: string): Promise<ReviewPackage | null>;
  listReviews(scope: ScopeKey, packageId: string): Promise<readonly CaseReview[]>;
  listApprovals(scope: ScopeKey, packageId: string): Promise<readonly CaseApproval[]>;
  listLedgerReferences(scope: ScopeKey, caseId: string): Promise<readonly LedgerReference[]>;
  listFilingReceipts(scope: ScopeKey, caseId: string): Promise<readonly FilingReceipt[]>;
}

export interface CaseTransitionInput {
  caseId: string;
  /** The case's version as the screen read it (case_changed on a stale one). */
  caseVersion: number;
  /** Made once per confirmation on the phone; a retry reuses it. */
  idempotencyKey: string;
}

export interface VerdictInput extends CaseTransitionInput {
  verdict: ReviewVerdict;
  note: string;
}

export interface ApproveInput extends CaseTransitionInput {
  /** The exact package the screen showed, by id and digest. */
  packageId: string;
  packageDigest: string;
  destination: string;
}

export interface FilingInput extends CaseTransitionInput {
  documentId: string;
  driveFileId: string;
  drivePath: string;
}

export interface TransitionReceipt {
  caseStatus: CaseStatus;
  caseVersion: number;
}

export interface FilingRecord {
  receiptId: string;
  status: FilingStatus;
  claimedDigest: string;
  packageId: string;
  caseVersion: number;
}

export interface RequestTransitionInput {
  requestId: string;
  /** The request's version as the screen read it (request_changed on a stale one). */
  requestVersion: number;
  idempotencyKey: string;
}

export interface RequestReceipt {
  requestId: string;
  requestStatus: 'CLOSED';
  requestVersion: number;
}

export interface OpenCaseInput {
  title: string;
  idempotencyKey: string;
}

export interface OpenedCase {
  caseId: string;
  caseStatus: CaseStatus;
  caseVersion: number;
}

export interface OpenRequestInput extends CaseTransitionInput {
  title: string;
  detail: string;
  /** Days from today, or null for no due date. */
  dueInDays: number | null;
  /** A checked document of the case the question is about, or null. */
  subjectDocumentId: string | null;
}

export interface OpenedRequest {
  requestId: string;
  requestVersion: number;
  caseStatus: CaseStatus;
  caseVersion: number;
}

export interface ReviewWriter {
  freeze(scope: ScopeKey, input: CaseTransitionInput): Promise<TransitionReceipt>;
  startReview(scope: ScopeKey, input: CaseTransitionInput): Promise<TransitionReceipt>;
  recordVerdict(scope: ScopeKey, input: VerdictInput): Promise<TransitionReceipt>;
  resume(scope: ScopeKey, input: CaseTransitionInput): Promise<TransitionReceipt>;
  approve(scope: ScopeKey, input: ApproveInput): Promise<TransitionReceipt>;
  recordFiling(scope: ScopeKey, input: FilingInput): Promise<FilingRecord>;
  /** Intake (WO-013): the draft is recorded, a draft with nothing in it is
   * discarded, a request is closed. */
  recordIntake(scope: ScopeKey, input: CaseTransitionInput): Promise<TransitionReceipt>;
  discardDraft(scope: ScopeKey, input: CaseTransitionInput): Promise<TransitionReceipt>;
  closeRequest(scope: ScopeKey, input: RequestTransitionInput): Promise<RequestReceipt>;
}

/** The creations of intake (WO-013): a case, and a request on it. */
export interface IntakeWriter {
  openCase(scope: ScopeKey, input: OpenCaseInput): Promise<OpenedCase>;
  openRequest(scope: ScopeKey, input: OpenRequestInput): Promise<OpenedRequest>;
}

/** Every refusal token the server can answer with, verbatim. */
export const REVIEW_REFUSALS = [
  'case_not_found',
  'case_changed',
  'case_not_freezable',
  'case_not_reviewable',
  'package_missing',
  'conflict_of_interest',
  'review_in_progress',
  'not_your_review',
  'invalid_verdict',
  'note_too_long',
  'invalid_text',
  'case_not_resumable',
  'case_not_approvable',
  'package_changed',
  'digest_mismatch',
  'invalid_destination',
  'review_missing',
  'invalid_idempotency_key',
  'case_not_approved',
  'document_not_filable',
  'document_not_approved',
  'invalid_file_id',
  'invalid_path',
  'receipt_exists',
  // Intake (WO-013).
  'invalid_title',
  'too_many_drafts',
  'case_not_draft',
  'case_has_children',
  'case_not_open_for_requests',
  'invalid_detail',
  'invalid_due',
  'document_not_checked',
  'too_many_requests',
  'request_not_found',
  'request_changed',
  'request_not_closable',
] as const;

export type ReviewRefusal = (typeof REVIEW_REFUSALS)[number];

export class ReviewRefusedError extends Error {
  constructor(readonly refusal: ReviewRefusal) {
    super(`transition refused: ${refusal}`);
    this.name = 'ReviewRefusedError';
  }
}

interface RefusalShapedError {
  code?: string;
  message?: string;
}

export function mapReviewError(error: unknown): ReviewRefusedError | SafeError {
  if (error instanceof ReviewRefusedError || error instanceof SafeError) return error;
  const e = (error ?? {}) as RefusalShapedError;
  if (
    e.code === 'P0001' &&
    typeof e.message === 'string' &&
    (REVIEW_REFUSALS as readonly string[]).includes(e.message)
  ) {
    return new ReviewRefusedError(e.message as ReviewRefusal);
  }
  return mapDbError(error);
}

const CASE_STATUSES: readonly string[] = [
  'DRAFT',
  'INTAKE_RECORDED',
  'EVIDENCE_PENDING',
  'READY_FOR_REVIEW',
  'IN_REVIEW',
  'APPROVAL_PENDING',
  'APPROVED',
  'RETURNED',
  'HOLD',
];

function isCaseStatus(value: string): value is CaseStatus {
  return CASE_STATUSES.includes(value);
}

function isVerdict(value: unknown): value is ReviewVerdict {
  return value === 'PASS' || value === 'RETURN' || value === 'HOLD';
}

function isReviewRole(value: string): value is ReviewRole {
  return value === 'reviewer' || value === 'approver';
}

function isApprovalStatus(value: string): value is ApprovalStatus {
  return value === 'ACTIVE' || value === 'EXPIRED' || value === 'SUPERSEDED';
}

function isFilingStatus(value: string): value is FilingStatus {
  return value === 'RECORDED' || value === 'VERIFIED' || value === 'MISMATCH';
}

function isFilingRole(value: string): value is FilingRole {
  return value === 'intake' || value === 'preparer';
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(asRecord) : [];
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** The manifest as the server wrote it, read defensively: a field the
 * app does not know is ignored, a missing one is empty. */
export function decodeManifest(value: unknown): PackageManifest {
  const v = asRecord(value);
  return {
    caseId: str(v['case_id']),
    requests: asArray(v['requests']).map((r) => ({
      id: str(r['id']),
      status: str(r['status']),
      version: num(r['version']),
    })),
    answers: asArray(v['answers']).map((a) => ({
      id: str(a['id']),
      requestId: str(a['request_id']),
      version: num(a['version']),
      bodySha256: str(a['body_sha256']),
    })),
    documents: asArray(v['documents']).map((d) => ({
      id: str(d['id']),
      requestId: str(d['request_id']),
      clientDigest: str(d['client_digest']),
      byteSize: num(d['byte_size']),
    })),
  };
}

function decodeReceipt(value: unknown): TransitionReceipt {
  const v = asRecord(value);
  const status = v['case_status'];
  if (
    typeof status !== 'string' ||
    !isCaseStatus(status) ||
    typeof v['case_version'] !== 'number'
  ) {
    throw new SafeError('unknown');
  }
  return { caseStatus: status, caseVersion: v['case_version'] };
}

function decodeRequestReceipt(value: unknown): RequestReceipt {
  const v = asRecord(value);
  if (
    typeof v['request_id'] !== 'string' ||
    v['request_status'] !== 'CLOSED' ||
    typeof v['request_version'] !== 'number'
  ) {
    throw new SafeError('unknown');
  }
  return {
    requestId: v['request_id'],
    requestStatus: 'CLOSED',
    requestVersion: v['request_version'],
  };
}

function decodeOpenedCase(value: unknown): OpenedCase {
  const v = asRecord(value);
  const status = v['case_status'];
  if (
    typeof v['case_id'] !== 'string' ||
    typeof status !== 'string' ||
    !isCaseStatus(status) ||
    typeof v['case_version'] !== 'number'
  ) {
    throw new SafeError('unknown');
  }
  return { caseId: v['case_id'], caseStatus: status, caseVersion: v['case_version'] };
}

function decodeOpenedRequest(value: unknown): OpenedRequest {
  const v = asRecord(value);
  const status = v['case_status'];
  if (
    typeof v['request_id'] !== 'string' ||
    typeof v['request_version'] !== 'number' ||
    typeof status !== 'string' ||
    !isCaseStatus(status) ||
    typeof v['case_version'] !== 'number'
  ) {
    throw new SafeError('unknown');
  }
  return {
    requestId: v['request_id'],
    requestVersion: v['request_version'],
    caseStatus: status,
    caseVersion: v['case_version'],
  };
}

function decodeFilingRecord(value: unknown): FilingRecord {
  const v = asRecord(value);
  const status = v['status'];
  if (
    typeof v['receipt_id'] !== 'string' ||
    typeof status !== 'string' ||
    !isFilingStatus(status) ||
    typeof v['claimed_digest'] !== 'string' ||
    typeof v['package_id'] !== 'string' ||
    typeof v['case_version'] !== 'number'
  ) {
    throw new SafeError('unknown');
  }
  return {
    receiptId: v['receipt_id'],
    status,
    claimedDigest: v['claimed_digest'],
    packageId: v['package_id'],
    caseVersion: v['case_version'],
  };
}

export class ReviewRepository implements ScopedResource, ReviewLoader, ReviewWriter, IntakeWriter {
  private unregister: () => void;

  constructor(
    private readonly getClient: ClientAccessor,
    registry: ScopedRegistry,
  ) {
    this.unregister = registry.register(this);
  }

  clear(): void {
    // No cached state.
  }

  dispose(): void {
    this.unregister();
  }

  /** The case by id inside the scope: a route param is a filter, never
   * scope (threat T5), and a foreign id is null. */
  async getCase(scope: ScopeKey, caseId: string): Promise<CaseRecord | null> {
    const client = this.getClient();
    try {
      const result = await client
        .from('cases')
        .select('id, title, status, status_changed_at, version')
        .eq('environment_id', scope.environmentId)
        .eq('client_id', scope.clientId)
        .eq('entity_id', scope.entityId)
        .eq('id', caseId)
        .limit(1);
      if (result.error) throw result.error;
      const row = result.data[0];
      if (!row || !isCaseStatus(row.status)) return null;
      return {
        id: row.id,
        title: row.title,
        status: row.status,
        statusChangedAt: row.status_changed_at,
        version: row.version,
      };
    } catch (error) {
      throw mapDbError(error);
    }
  }

  async getCurrentPackage(scope: ScopeKey, caseId: string): Promise<ReviewPackage | null> {
    const client = this.getClient();
    try {
      const result = await client
        .from('case_review_packages')
        .select(
          'id, package_number, manifest, manifest_digest, case_version, frozen_role, frozen_at',
        )
        .eq('environment_id', scope.environmentId)
        .eq('client_id', scope.clientId)
        .eq('entity_id', scope.entityId)
        .eq('case_id', caseId)
        .is('superseded_at', null)
        .limit(1);
      if (result.error) throw result.error;
      const row = result.data[0];
      if (!row) return null;
      return {
        id: row.id,
        packageNumber: row.package_number,
        manifest: decodeManifest(row.manifest),
        manifestDigest: row.manifest_digest,
        caseVersion: row.case_version,
        frozenRole: row.frozen_role as MembershipRole,
        frozenAt: row.frozen_at,
      };
    } catch (error) {
      throw mapDbError(error);
    }
  }

  async listReviews(scope: ScopeKey, packageId: string): Promise<readonly CaseReview[]> {
    const client = this.getClient();
    try {
      const result = await client
        .from('case_reviews')
        .select('id, reviewer_role, status, verdict, note, started_at, recorded_at')
        .eq('environment_id', scope.environmentId)
        .eq('client_id', scope.clientId)
        .eq('entity_id', scope.entityId)
        .eq('package_id', packageId)
        .order('started_at', { ascending: true });
      if (result.error) throw result.error;
      const items: CaseReview[] = [];
      for (const row of result.data) {
        if (!isReviewRole(row.reviewer_role)) continue;
        items.push({
          id: row.id,
          reviewerRole: row.reviewer_role,
          status: row.status === 'RECORDED' ? 'RECORDED' : 'IN_PROGRESS',
          verdict: isVerdict(row.verdict) ? row.verdict : null,
          note: row.note,
          startedAt: row.started_at,
          recordedAt: row.recorded_at,
        });
      }
      return items;
    } catch (error) {
      throw mapDbError(error);
    }
  }

  async listApprovals(scope: ScopeKey, packageId: string): Promise<readonly CaseApproval[]> {
    const client = this.getClient();
    try {
      const result = await client
        .from('case_approvals')
        .select(
          'id, status, package_number, package_digest, destination, approved_at, expires_at, ended_at, end_reason',
        )
        .eq('environment_id', scope.environmentId)
        .eq('client_id', scope.clientId)
        .eq('entity_id', scope.entityId)
        .eq('package_id', packageId)
        .order('approved_at', { ascending: false });
      if (result.error) throw result.error;
      const items: CaseApproval[] = [];
      for (const row of result.data) {
        if (!isApprovalStatus(row.status)) continue;
        items.push({
          id: row.id,
          status: row.status,
          packageNumber: row.package_number,
          packageDigest: row.package_digest,
          destination: row.destination,
          approvedAt: row.approved_at,
          expiresAt: row.expires_at,
          endedAt: row.ended_at,
          endReason: row.end_reason,
        });
      }
      return items;
    } catch (error) {
      throw mapDbError(error);
    }
  }

  async listLedgerReferences(scope: ScopeKey, caseId: string): Promise<readonly LedgerReference[]> {
    const client = this.getClient();
    try {
      const result = await client
        .from('ledger_references')
        .select(
          'id, source, realm_id, object_type, object_id, object_version, display_name, as_of, object_digest, adapter_name, recorded_at',
        )
        .eq('environment_id', scope.environmentId)
        .eq('client_id', scope.clientId)
        .eq('entity_id', scope.entityId)
        .eq('case_id', caseId)
        .order('recorded_at', { ascending: false });
      if (result.error) throw result.error;
      return result.data.map((row) => ({
        id: row.id,
        source: row.source,
        realmId: row.realm_id,
        objectType: row.object_type,
        objectId: row.object_id,
        objectVersion: row.object_version,
        displayName: row.display_name,
        asOf: row.as_of,
        objectDigest: row.object_digest,
        adapterName: row.adapter_name,
        recordedAt: row.recorded_at,
      }));
    } catch (error) {
      throw mapDbError(error);
    }
  }

  async listFilingReceipts(scope: ScopeKey, caseId: string): Promise<readonly FilingReceipt[]> {
    const client = this.getClient();
    try {
      const result = await client
        .from('filing_receipts')
        .select(
          'id, document_id, package_id, drive_file_id, drive_path, claimed_digest, filed_role, filed_at, status, verified_at, found_digest, adapter_name',
        )
        .eq('environment_id', scope.environmentId)
        .eq('client_id', scope.clientId)
        .eq('entity_id', scope.entityId)
        .eq('case_id', caseId)
        .order('filed_at', { ascending: false });
      if (result.error) throw result.error;
      const items: FilingReceipt[] = [];
      for (const row of result.data) {
        if (!isFilingStatus(row.status) || !isFilingRole(row.filed_role)) continue;
        items.push({
          id: row.id,
          documentId: row.document_id,
          packageId: row.package_id,
          driveFileId: row.drive_file_id,
          drivePath: row.drive_path,
          claimedDigest: row.claimed_digest,
          filedRole: row.filed_role,
          filedAt: row.filed_at,
          status: row.status,
          verifiedAt: row.verified_at,
          foundDigest: row.found_digest,
          adapterName: row.adapter_name,
        });
      }
      return items;
    } catch (error) {
      throw mapDbError(error);
    }
  }

  private async call(
    name:
      | 'freeze_case_package'
      | 'start_case_review'
      | 'record_case_verdict'
      | 'resume_case'
      | 'approve_case_package'
      | 'record_filing_receipt',
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const client = this.getClient();
    try {
      // The functions share one calling shape; the union above keeps the
      // call typed against the generated database types.
      const result = await client.rpc(name as 'freeze_case_package', args as never);
      if (result.error) throw result.error;
      return result.data;
    } catch (error) {
      throw mapReviewError(error);
    }
  }

  private async transition(
    name:
      | 'freeze_case_package'
      | 'start_case_review'
      | 'record_case_verdict'
      | 'resume_case'
      | 'approve_case_package',
    args: Record<string, unknown>,
  ): Promise<TransitionReceipt> {
    return decodeReceipt(await this.call(name, args));
  }

  private scoped(scope: ScopeKey, input: CaseTransitionInput): Record<string, unknown> {
    return {
      p_environment_id: scope.environmentId,
      p_client_id: scope.clientId,
      p_entity_id: scope.entityId,
      p_case_id: input.caseId,
      p_case_version: input.caseVersion,
      p_idempotency_key: input.idempotencyKey,
    };
  }

  freeze(scope: ScopeKey, input: CaseTransitionInput): Promise<TransitionReceipt> {
    return this.transition('freeze_case_package', this.scoped(scope, input));
  }

  startReview(scope: ScopeKey, input: CaseTransitionInput): Promise<TransitionReceipt> {
    return this.transition('start_case_review', this.scoped(scope, input));
  }

  recordVerdict(scope: ScopeKey, input: VerdictInput): Promise<TransitionReceipt> {
    return this.transition('record_case_verdict', {
      ...this.scoped(scope, input),
      p_verdict: input.verdict,
      p_note: input.note,
    });
  }

  resume(scope: ScopeKey, input: CaseTransitionInput): Promise<TransitionReceipt> {
    return this.transition('resume_case', this.scoped(scope, input));
  }

  approve(scope: ScopeKey, input: ApproveInput): Promise<TransitionReceipt> {
    return this.transition('approve_case_package', {
      ...this.scoped(scope, input),
      p_package_id: input.packageId,
      p_package_digest: input.packageDigest,
      p_destination: input.destination,
    });
  }

  async recordFiling(scope: ScopeKey, input: FilingInput): Promise<FilingRecord> {
    return decodeFilingRecord(
      await this.call('record_filing_receipt', {
        ...this.scoped(scope, input),
        p_document_id: input.documentId,
        p_drive_file_id: input.driveFileId,
        p_drive_path: input.drivePath,
      }),
    );
  }

  // ---- Intake (WO-013) ----------------------------------------------------

  async recordIntake(scope: ScopeKey, input: CaseTransitionInput): Promise<TransitionReceipt> {
    const client = this.getClient();
    try {
      const result = await client.rpc('record_case_intake', {
        p_environment_id: scope.environmentId,
        p_client_id: scope.clientId,
        p_entity_id: scope.entityId,
        p_case_id: input.caseId,
        p_case_version: input.caseVersion,
        p_idempotency_key: input.idempotencyKey,
      });
      if (result.error) throw result.error;
      return decodeReceipt(result.data);
    } catch (error) {
      throw mapReviewError(error);
    }
  }

  async discardDraft(scope: ScopeKey, input: CaseTransitionInput): Promise<TransitionReceipt> {
    const client = this.getClient();
    try {
      const result = await client.rpc('discard_case_draft', {
        p_environment_id: scope.environmentId,
        p_client_id: scope.clientId,
        p_entity_id: scope.entityId,
        p_case_id: input.caseId,
        p_case_version: input.caseVersion,
        p_idempotency_key: input.idempotencyKey,
      });
      if (result.error) throw result.error;
      return decodeReceipt(result.data);
    } catch (error) {
      throw mapReviewError(error);
    }
  }

  async closeRequest(scope: ScopeKey, input: RequestTransitionInput): Promise<RequestReceipt> {
    const client = this.getClient();
    try {
      const result = await client.rpc('close_request', {
        p_environment_id: scope.environmentId,
        p_client_id: scope.clientId,
        p_entity_id: scope.entityId,
        p_request_id: input.requestId,
        p_request_version: input.requestVersion,
        p_idempotency_key: input.idempotencyKey,
      });
      if (result.error) throw result.error;
      return decodeRequestReceipt(result.data);
    } catch (error) {
      throw mapReviewError(error);
    }
  }

  async openCase(scope: ScopeKey, input: OpenCaseInput): Promise<OpenedCase> {
    const client = this.getClient();
    try {
      const result = await client.rpc('open_case', {
        p_environment_id: scope.environmentId,
        p_client_id: scope.clientId,
        p_entity_id: scope.entityId,
        p_title: input.title,
        p_idempotency_key: input.idempotencyKey,
      });
      if (result.error) throw result.error;
      return decodeOpenedCase(result.data);
    } catch (error) {
      throw mapReviewError(error);
    }
  }

  async openRequest(scope: ScopeKey, input: OpenRequestInput): Promise<OpenedRequest> {
    const client = this.getClient();
    try {
      const result = await client.rpc('open_request', {
        p_environment_id: scope.environmentId,
        p_client_id: scope.clientId,
        p_entity_id: scope.entityId,
        p_case_id: input.caseId,
        p_case_version: input.caseVersion,
        p_title: input.title,
        p_detail: input.detail,
        p_due_in_days: input.dueInDays ?? undefined,
        p_subject_document_id: input.subjectDocumentId ?? undefined,
        p_idempotency_key: input.idempotencyKey,
      });
      if (result.error) throw result.error;
      return decodeOpenedRequest(result.data);
    } catch (error) {
      throw mapReviewError(error);
    }
  }
}
