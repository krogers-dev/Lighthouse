import type { RequestAnswer } from '@/data/supabase/answers';
import type { DocumentSummary } from '@/data/supabase/documents';
import type { RequestDetail } from '@/data/supabase/repositories';

import {
  ANSWER_LIMITS,
  answerLength,
  canAnswer,
  checkAnswerText,
  citableDocuments,
  formatCount,
  sanitizeAnswerText,
} from '../answer-rules';

const request: RequestDetail = {
  id: 'dddddddd-0000-4000-8000-0000000000a3',
  caseId: 'eeeeeeee-0000-4000-8000-0000000000a1',
  title: 'Confirm the November statement balance (Synthetic)',
  detail: 'Does the closing balance match your records? (Synthetic)',
  status: 'OPEN',
  ownerRole: 'client_user',
  requestedOn: '2026-08-15',
  dueOn: '2026-09-15',
  version: 1,
  subjectDocumentId: 'd0c0d0c0-0000-4000-8000-0000000000a3',
};

const draft: RequestAnswer = {
  id: 'ans-1',
  requestId: request.id,
  status: 'DRAFT',
  body: 'Yes (Synthetic).',
  version: 1,
  citedDocumentIds: [],
  submittedAt: null,
  updatedAt: '2026-09-28T16:00:00Z',
};

function document(status: DocumentSummary['status']): DocumentSummary {
  return {
    id: `doc-${status}`,
    displayName: `${status.toLowerCase()} (Synthetic).pdf`,
    mimeType: 'application/pdf',
    byteSize: 10,
    status,
    receivedAt: '2026-09-28T15:00:00Z',
    checkedAt: null,
  };
}

describe('answer text rules', () => {
  it('strips control characters but keeps newlines and tabs', () => {
    expect(sanitizeAnswerText('a\u0001b\nc\td\u007f')).toBe('ab\nc\td');
    expect(sanitizeAnswerText('plain (Synthetic)')).toBe('plain (Synthetic)');
  });

  it('counts characters the way the server does (code points)', () => {
    expect(answerLength('héllo')).toBe(5);
    expect(answerLength('\u{1F600}')).toBe(1);
  });

  it('refuses a blank or over-long submission and passes the rest, sanitized', () => {
    expect(checkAnswerText('   \n\t')).toEqual({ ok: false, refusal: 'empty_answer' });
    expect(checkAnswerText('x'.repeat(ANSWER_LIMITS.maxLength + 1))).toEqual({
      ok: false,
      refusal: 'answer_too_long',
    });
    expect(checkAnswerText('x'.repeat(ANSWER_LIMITS.maxLength))).toMatchObject({ ok: true });
    expect(checkAnswerText('Yes\u0000 (Synthetic).')).toEqual({
      ok: true,
      body: 'Yes (Synthetic).',
    });
  });

  it('formats counts with thousands separators', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(999)).toBe('999');
    expect(formatCount(4000)).toBe('4,000');
    expect(formatCount(1234567)).toBe('1,234,567');
  });
});

describe('citable documents', () => {
  it('are the received and checked ones, never a refused or expired one', () => {
    const all = (['QUARANTINED', 'VALIDATING', 'ACCEPTED', 'REJECTED', 'EXPIRED'] as const).map(
      document,
    );
    expect(citableDocuments(all).map((item) => item.status)).toEqual([
      'QUARANTINED',
      'VALIDATING',
      'ACCEPTED',
    ]);
  });
});

describe('canAnswer', () => {
  it('is the client user on an open request without a submitted answer', () => {
    expect(canAnswer('client_user', request, null)).toBe(true);
    expect(canAnswer('client_user', request, draft)).toBe(true);
    expect(
      canAnswer('client_user', request, {
        ...draft,
        status: 'SUBMITTED',
        submittedAt: '2026-09-28T16:05:00Z',
      }),
    ).toBe(false);
  });

  it('is never staff, a closed request, or no request', () => {
    for (const role of ['intake', 'preparer', 'reviewer', 'approver', null] as const) {
      expect(canAnswer(role, request, null)).toBe(false);
    }
    for (const status of ['ANSWERED', 'CLOSED', 'EXPIRED'] as const) {
      expect(canAnswer('client_user', { ...request, status }, null)).toBe(false);
    }
    expect(canAnswer('client_user', null, null)).toBe(false);
  });
});
