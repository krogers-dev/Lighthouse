/** The review and approval path, end to end, through the shipped
 * composition (WO-005).
 *
 * Three staff identities, each signed in through OTP and a TOTP
 * enrollment exactly as the screens drive it: preparer.pat freezes the
 * seeded case's evidence into a package; mixed.same (reviewer on A1)
 * starts the review and passes it; approver.avery approves the exact
 * package by id and digest, for the HIVE record, and the approval reads
 * back active with its expiry. Every transition names the case version
 * the repository read. Then (WO-006) intake.beth reads the references the
 * named synthetic ledger adapter recorded for the case and records a
 * filing receipt for an approved, checked document at the synthetic Drive
 * file that holds its bytes, meeting the refusals on the way. Runs only
 * through the bridge lanes; on the CLI stack the lane resets the case and
 * the four factors first and syncs the synthetic ledger.
 */
import type { AuthState } from '@/auth/machine';
import { ReviewRefusedError } from '@/data/supabase/reviews';

import { totpCode } from '../../scripts/lib/totp.mjs';

import { buildApp, signInWithOtp, waitForState } from './journeys';

const A1_ENTITY = 'aaaaaaaa-1111-4000-8000-000000000001';
const CASE = 'eeeeeeee-0000-4000-8000-0000000000a1';
// Milestone 5 (WO-006): the seeded July statement (checked) and the seeded
// rejected photo, and the synthetic folder intake files under by hand.
const JULY_STATEMENT = 'd0c0d0c0-0000-4000-8000-0000000000a1';
const REJECTED_PHOTO = 'd0c0d0c0-0000-4000-8000-0000000000a2';
const DRIVE_FOLDER = '/Clients/Harbor Light Bakery LLC (Synthetic)/2025 books close (Synthetic)';

function uuidV4(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** OTP, TOTP enrollment (this lane's factors are reset before it runs),
 * then the A1 membership with the wanted role. */
async function signInStaff(email: string, role: string) {
  const app = buildApp();
  await app.controller.boot();
  await waitForState(app.controller, `${email} boot`, (state) => state.name === 'signed_out');
  await signInWithOtp(app, email);
  const mfa = (await waitForState(
    app.controller,
    `${email} enrollment offered`,
    (state) => state.name === 'mfa_required' && state.enrollment !== undefined,
  )) as Extract<AuthState, { name: 'mfa_required' }>;
  await app.controller.submitTotp(totpCode(mfa.enrollment!.secret));
  const landed = (await waitForState(
    app.controller,
    `${email} after TOTP`,
    (state) => state.name === 'authorized' || state.name === 'select_scope',
  )) as Extract<AuthState, { name: 'authorized' | 'select_scope' }>;
  if (landed.name === 'select_scope') {
    const membership = landed.memberships.find(
      (candidate) => candidate.entityId === A1_ENTITY && candidate.role === role,
    );
    if (!membership) throw new Error(`${email}: no ${role} membership on A1 in the live chooser`);
    await app.controller.selectScope(membership.membershipId);
  }
  const authorized = (await waitForState(
    app.controller,
    `${email} authorized`,
    (state) => state.name === 'authorized',
  )) as Extract<AuthState, { name: 'authorized' }>;
  return { app, scope: authorized.scope };
}

jest.setTimeout(180_000);

describe('live bridge: review and approval through the shipped composition', () => {
  test('preparer freezes, reviewer passes, approver approves the exact package, each at AAL2', async () => {
    const preparer = await signInStaff('preparer.pat@example.invalid', 'preparer');
    const before = await preparer.app.review.getCase(preparer.scope, CASE);
    if (!before) throw new Error('the seeded case is missing');
    expect(before.status).toBe('EVIDENCE_PENDING');
    expect(await preparer.app.review.getCurrentPackage(preparer.scope, CASE)).toBeNull();
    // A stale version is a refusal the screen words, never an overwrite.
    await expect(
      preparer.app.review.freeze(preparer.scope, {
        caseId: CASE,
        caseVersion: before.version + 7,
        idempotencyKey: uuidV4(),
      }),
    ).rejects.toMatchObject({ refusal: 'case_changed' });
    const frozen = await preparer.app.review.freeze(preparer.scope, {
      caseId: CASE,
      caseVersion: before.version,
      idempotencyKey: uuidV4(),
    });
    expect(frozen).toEqual({ caseStatus: 'READY_FOR_REVIEW', caseVersion: before.version + 1 });
    const packaged = await preparer.app.review.getCurrentPackage(preparer.scope, CASE);
    expect(packaged).toMatchObject({ packageNumber: 1, frozenRole: 'preparer' });
    expect(packaged?.manifest.requests.length).toBeGreaterThanOrEqual(3);
    expect(packaged?.manifestDigest).toMatch(/^[0-9a-f]{64}$/);
    // The preparer who froze it cannot approve it, and holds no such role anyway.
    await expect(
      preparer.app.review.approve(preparer.scope, {
        caseId: CASE,
        caseVersion: before.version + 1,
        packageId: packaged!.id,
        packageDigest: packaged!.manifestDigest,
        destination: 'hive-record',
        idempotencyKey: uuidV4(),
      }),
    ).rejects.toMatchObject({ code: 'denied' });
    await preparer.app.controller.signOut();
    await waitForState(
      preparer.app.controller,
      'preparer out',
      (state) => state.name === 'signed_out',
    );

    const reviewer = await signInStaff('mixed.same@example.invalid', 'reviewer');
    const ready = await reviewer.app.review.getCase(reviewer.scope, CASE);
    const started = await reviewer.app.review.startReview(reviewer.scope, {
      caseId: CASE,
      caseVersion: ready!.version,
      idempotencyKey: uuidV4(),
    });
    expect(started.caseStatus).toBe('IN_REVIEW');
    const passed = await reviewer.app.review.recordVerdict(reviewer.scope, {
      caseId: CASE,
      caseVersion: started.caseVersion,
      verdict: 'PASS',
      note: 'Complete and consistent (Synthetic).',
      idempotencyKey: uuidV4(),
    });
    expect(passed.caseStatus).toBe('APPROVAL_PENDING');
    const reviews = await reviewer.app.review.listReviews(reviewer.scope, packaged!.id);
    expect(reviews).toHaveLength(1);
    expect(reviews[0]).toMatchObject({
      reviewerRole: 'reviewer',
      verdict: 'PASS',
      status: 'RECORDED',
    });
    await reviewer.app.controller.signOut();
    await waitForState(
      reviewer.app.controller,
      'reviewer out',
      (state) => state.name === 'signed_out',
    );

    const approver = await signInStaff('approver.avery@example.invalid', 'approver');
    const pending = await approver.app.review.getCase(approver.scope, CASE);
    const current = await approver.app.review.getCurrentPackage(approver.scope, CASE);
    expect(current?.id).toBe(packaged!.id);
    await expect(
      approver.app.review.approve(approver.scope, {
        caseId: CASE,
        caseVersion: pending!.version,
        packageId: current!.id,
        packageDigest: '0'.repeat(64),
        destination: 'hive-record',
        idempotencyKey: uuidV4(),
      }),
    ).rejects.toBeInstanceOf(ReviewRefusedError);
    const approved = await approver.app.review.approve(approver.scope, {
      caseId: CASE,
      caseVersion: pending!.version,
      packageId: current!.id,
      packageDigest: current!.manifestDigest,
      destination: 'hive-record',
      idempotencyKey: uuidV4(),
    });
    expect(approved.caseStatus).toBe('APPROVED');
    const approvals = await approver.app.review.listApprovals(approver.scope, current!.id);
    expect(approvals[0]).toMatchObject({
      status: 'ACTIVE',
      packageDigest: current!.manifestDigest,
      destination: 'hive-record',
    });
    expect(new Date(approvals[0]!.expiresAt).getTime()).toBeGreaterThan(Date.now());
    const activity = await approver.app.activity.list(approver.scope);
    expect(activity.items.some((entry) => entry.kind === 'case.approved')).toBe(true);
    await approver.app.controller.signOut();
    await waitForState(
      approver.app.controller,
      'approver out',
      (state) => state.name === 'signed_out',
    );

    // Milestone 5 (WO-006): the sources and the permanent record, as intake.
    const intake = await signInStaff('intake.beth@example.invalid', 'intake');
    const references = await intake.app.review.listLedgerReferences(intake.scope, CASE);
    expect(references.map((reference) => reference.objectType).sort()).toEqual([
      'Account',
      'JournalEntry',
      'Report',
    ]);
    expect(references.every((reference) => reference.adapterName === 'HiveSyntheticLedger')).toBe(
      true,
    );
    const approvedCase = await intake.app.review.getCase(intake.scope, CASE);
    const approvedPackage = await intake.app.review.getCurrentPackage(intake.scope, CASE);
    const documents = await intake.app.documents.listByCase(intake.scope, CASE);
    expect(documents.find((document) => document.id === JULY_STATEMENT)?.status).toBe('ACCEPTED');
    await expect(
      intake.app.review.recordFiling(intake.scope, {
        caseId: CASE,
        caseVersion: approvedCase!.version,
        documentId: REJECTED_PHOTO,
        driveFileId: 'drv-synthetic-0001',
        drivePath: DRIVE_FOLDER,
        idempotencyKey: uuidV4(),
      }),
    ).rejects.toMatchObject({ refusal: 'document_not_filable' });
    const filed = await intake.app.review.recordFiling(intake.scope, {
      caseId: CASE,
      caseVersion: approvedCase!.version,
      documentId: JULY_STATEMENT,
      driveFileId: 'drv-synthetic-0001',
      drivePath: DRIVE_FOLDER,
      idempotencyKey: uuidV4(),
    });
    const manifestEntry = approvedPackage!.manifest.documents.find(
      (document) => document.id === JULY_STATEMENT,
    );
    expect(filed).toMatchObject({
      status: 'RECORDED',
      packageId: approvedPackage!.id,
      claimedDigest: manifestEntry!.clientDigest,
      caseVersion: approvedCase!.version,
    });
    await expect(
      intake.app.review.recordFiling(intake.scope, {
        caseId: CASE,
        caseVersion: approvedCase!.version,
        documentId: JULY_STATEMENT,
        driveFileId: 'drv-synthetic-0001',
        drivePath: DRIVE_FOLDER,
        idempotencyKey: uuidV4(),
      }),
    ).rejects.toMatchObject({ refusal: 'receipt_exists' });
    const receipts = await intake.app.review.listFilingReceipts(intake.scope, CASE);
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({
      id: filed.receiptId,
      documentId: JULY_STATEMENT,
      driveFileId: 'drv-synthetic-0001',
      drivePath: DRIVE_FOLDER,
      filedRole: 'intake',
      status: 'RECORDED',
      verifiedAt: null,
      foundDigest: null,
    });
    // The case did not move: a receipt is a record of a filing, not a transition.
    expect((await intake.app.review.getCase(intake.scope, CASE))?.version).toBe(
      approvedCase!.version,
    );
    const trail = await intake.app.activity.list(intake.scope);
    expect(trail.items.some((entry) => entry.kind === 'source.referenced')).toBe(true);
    expect(trail.items.some((entry) => entry.kind === 'record.filed')).toBe(true);
    await intake.app.controller.signOut();
    await waitForState(intake.app.controller, 'intake out', (state) => state.name === 'signed_out');
  });
});
