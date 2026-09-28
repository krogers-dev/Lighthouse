import type { CaseStatus } from '@/data/supabase/repositories';
import type { MembershipRole } from '@/tenancy/types';

import {
  APPROVAL_DESTINATION,
  NOTE_LIMITS,
  actionsFor,
  checkNote,
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
  it('gives the preparer freeze on evidence, and resume after a return or an approval', () => {
    expect(actionsFor('preparer', 'EVIDENCE_PENDING')).toEqual(['freeze']);
    expect(actionsFor('preparer', 'RETURNED')).toEqual(['resume']);
    expect(actionsFor('preparer', 'APPROVED')).toEqual(['resume']);
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

  it('gives intake, clients, and nobody nothing at all', () => {
    for (const role of ['intake', 'client_user', null] as (MembershipRole | null)[]) {
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

describe('the approval destination', () => {
  it('is the HIVE record and nothing external', () => {
    expect(APPROVAL_DESTINATION).toBe('hive-record');
  });
});
