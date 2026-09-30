import type { DocumentSummary } from '@/data/supabase/documents';

import {
  DETAIL_LIMITS,
  DUE_CHOICES,
  TITLE_LIMITS,
  canAskOnCase,
  canOpenCase,
  checkDetail,
  checkTitle,
  cleanTitle,
  detailLength,
  dueChoiceLabel,
  sanitizeTitle,
  subjectDocuments,
  titleLength,
} from '../intake-rules';

describe('who may do what', () => {
  it('lets intake open a case and nobody else', () => {
    expect(canOpenCase('intake')).toBe(true);
    for (const role of ['client_user', 'preparer', 'reviewer', 'approver', null] as const) {
      expect(canOpenCase(role)).toBe(false);
    }
  });

  it('lets intake or the preparer ask once the intake is recorded and while evidence is gathered', () => {
    expect(canAskOnCase('intake', 'INTAKE_RECORDED')).toBe(true);
    expect(canAskOnCase('preparer', 'EVIDENCE_PENDING')).toBe(true);
    expect(canAskOnCase('intake', 'DRAFT')).toBe(false);
    expect(canAskOnCase('preparer', 'READY_FOR_REVIEW')).toBe(false);
    expect(canAskOnCase('reviewer', 'EVIDENCE_PENDING')).toBe(false);
    expect(canAskOnCase('client_user', 'EVIDENCE_PENDING')).toBe(false);
    expect(canAskOnCase('intake', null)).toBe(false);
    expect(canAskOnCase(null, 'EVIDENCE_PENDING')).toBe(false);
  });
});

describe('titles', () => {
  it('are one line, trimmed and single-spaced, as the server stores them', () => {
    expect(sanitizeTitle('Books\nclose\t2026\u0001')).toBe('Books close 2026');
    expect(cleanTitle('  Books   close  2026 ')).toBe('Books close 2026');
    expect(checkTitle('  Books   close  2026 ')).toEqual({ ok: true, title: 'Books close 2026' });
  });

  it('refuse one character or over 120 before any round trip', () => {
    expect(checkTitle('')).toEqual({ ok: false, refusal: 'title_missing' });
    expect(checkTitle('  x  ')).toEqual({ ok: false, refusal: 'title_missing' });
    expect(checkTitle('x'.repeat(TITLE_LIMITS.maxLength))).toMatchObject({ ok: true });
    expect(checkTitle('x'.repeat(TITLE_LIMITS.maxLength + 1))).toEqual({
      ok: false,
      refusal: 'title_too_long',
    });
    expect(titleLength('  ab  ')).toBe(2);
  });
});

describe('details', () => {
  it('may be blank, keep their line breaks, and are bounded', () => {
    expect(checkDetail('')).toEqual({ ok: true, detail: '' });
    expect(checkDetail(' Every month.\nStatements only. ')).toEqual({
      ok: true,
      detail: 'Every month.\nStatements only.',
    });
    expect(checkDetail('a'.repeat(DETAIL_LIMITS.maxLength + 1))).toEqual({
      ok: false,
      refusal: 'detail_too_long',
    });
    expect(detailLength('ab\u0001c')).toBe(3);
  });
});

describe('due dates and subjects', () => {
  it('offer none or a fixed number of days, worded plainly', () => {
    expect(DUE_CHOICES).toEqual([null, 7, 14, 30]);
    expect(dueChoiceLabel(null)).toBe('No due date');
    expect(dueChoiceLabel(14)).toBe('In 14 days');
  });

  it('let a question be about a checked document only', () => {
    const documents: DocumentSummary[] = [
      { id: 'd1', status: 'ACCEPTED', displayName: 'a (Synthetic).pdf' } as DocumentSummary,
      { id: 'd2', status: 'QUARANTINED', displayName: 'b (Synthetic).pdf' } as DocumentSummary,
      { id: 'd3', status: 'REJECTED', displayName: 'c (Synthetic).pdf' } as DocumentSummary,
    ];
    expect(subjectDocuments(documents).map((document) => document.id)).toEqual(['d1']);
  });
});
