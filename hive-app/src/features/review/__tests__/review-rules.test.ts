import type { DocumentSummary } from '@/data/supabase/documents';
import type { CaseStatus } from '@/data/supabase/repositories';
import type { MembershipRole } from '@/tenancy/types';

import {
  APPROVAL_DESTINATION,
  FILING_LIMITS,
  NOTE_LIMITS,
  actionsFor,
  checkFiling,
  checkNote,
  filableDocuments,
  verdictsFor,
} from '../review-rules';

const STATUSES: readonly CaseStatus[] = [
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

describe('actionsFor', () => {
  it('gives the preparer freeze on evidence, resume after a return, and filing-or-resume after an approval', () => {
    expect(actionsFor('preparer', 'EVIDENCE_PENDING')).toEqual(['freeze']);
    expect(actionsFor('preparer', 'RETURNED')).toEqual(['resume']);
    expect(actionsFor('preparer', 'APPROVED')).toEqual(['record_filing', 'resume']);
    for (const status of ['READY_FOR_REVIEW', 'IN_REVIEW', 'APPROVAL_PENDING', 'HOLD'] as const) {
      expect(actionsFor('preparer', status)).toEqual([]);
    }
  });

  it('gives the reviewer start on a ready case and the verdict while in review', () => {
    expect(actionsFor('reviewer', 'READY_FOR_REVIEW')).toEqual(['start_review']);
    expect(actionsFor('reviewer', 'IN_REVIEW')).toEqual(['record_verdict']);
    expect(actionsFor('reviewer', 'APPROVAL_PENDING')).toEqual([]);
  });

  it('gives the approver approve-or-verdict on a passed package and the lift of a hold', () => {
    expect(actionsFor('approver', 'APPROVAL_PENDING')).toEqual(['approve', 'record_verdict']);
    expect(actionsFor('approver', 'HOLD')).toEqual(['resume']);
    expect(actionsFor('approver', 'IN_REVIEW')).toEqual([]);
  });

  it('gives intake the filing receipt on an approved case only, and clients and nobody nothing', () => {
    for (const status of STATUSES) {
      expect(actionsFor('intake', status)).toEqual(status === 'APPROVED' ? ['record_filing'] : []);
    }
    for (const role of ['client_user', null] as (MembershipRole | null)[]) {
      for (const status of STATUSES) expect(actionsFor(role, status)).toEqual([]);
    }
    expect(actionsFor('approver', null)).toEqual([]);
  });
});

describe('verdictsFor', () => {
  it('lets a reviewer record any verdict and an approver only the two that stop a package', () => {
    expect(verdictsFor('reviewer')).toEqual(['PASS', 'RETURN', 'HOLD']);
    expect(verdictsFor('approver')).toEqual(['RETURN', 'HOLD']);
    expect(verdictsFor('preparer')).toEqual([]);
    expect(verdictsFor(null)).toEqual([]);
  });
});

describe('checkNote', () => {
  it('allows a blank note, strips control characters, and refuses the bound', () => {
    expect(checkNote('')).toEqual({ ok: true, note: '' });
    expect(checkNote('Missing page\u0001 (Synthetic)')).toEqual({
      ok: true,
      note: 'Missing page (Synthetic)',
    });
    expect(checkNote('x'.repeat(NOTE_LIMITS.maxLength))).toMatchObject({ ok: true });
    expect(checkNote('x'.repeat(NOTE_LIMITS.maxLength + 1))).toEqual({
      ok: false,
      refusal: 'note_too_long',
    });
  });
});

describe('filing receipts (WO-006)', () => {
  const document = (id: string, status: DocumentSummary['status']): DocumentSummary => ({
    id,
    displayName: id + ' (Synthetic).pdf',
    mimeType: 'application/pdf',
    byteSize: 1024,
    status,
    receivedAt: '2026-09-28T12:00:00Z',
    checkedAt: status === 'ACCEPTED' ? '2026-09-28T12:01:00Z' : null,
  });

  it('offers only checked documents for filing', () => {
    const accepted = document('a', 'ACCEPTED');
    expect(
      filableDocuments([
        document('v', 'VALIDATING'),
        accepted,
        document('r', 'REJECTED'),
        document('q', 'QUARANTINED'),
        document('e', 'EXPIRED'),
      ]),
    ).toEqual([accepted]);
  });

  it('needs a document, a Drive file id in its shape, and a bounded printable path', () => {
    const good = {
      documentId: 'doc-1',
      driveFileId: ' drv-synthetic-0001 ',
      drivePath: ' /Clients/Harbor Light Bakery LLC (Synthetic)\u0001 ',
    };
    expect(checkFiling(good)).toEqual({
      ok: true,
      documentId: 'doc-1',
      driveFileId: 'drv-synthetic-0001',
      drivePath: '/Clients/Harbor Light Bakery LLC (Synthetic)',
    });
    expect(checkFiling({ ...good, documentId: null })).toEqual({
      ok: false,
      refusal: 'document_missing',
    });
    for (const driveFileId of ['', '-leading', 'has space', 'x'.repeat(129), 'dot.ted', 'a/b']) {
      expect(checkFiling({ ...good, driveFileId })).toEqual({
        ok: false,
        refusal: 'invalid_file_id',
      });
    }
    expect(checkFiling({ ...good, driveFileId: 'x'.repeat(128) })).toMatchObject({ ok: true });
    expect(checkFiling({ ...good, drivePath: '   ' })).toEqual({
      ok: false,
      refusal: 'invalid_path',
    });
    expect(
      checkFiling({ ...good, drivePath: 'p'.repeat(FILING_LIMITS.pathMaxLength + 1) }),
    ).toEqual({ ok: false, refusal: 'invalid_path' });
    expect(
      checkFiling({ ...good, drivePath: 'p'.repeat(FILING_LIMITS.pathMaxLength) }),
    ).toMatchObject({ ok: true });
  });
});

describe('the approval destination', () => {
  it('is the HIVE record and nothing external', () => {
    expect(APPROVAL_DESTINATION).toBe('hive-record');
  });
});
