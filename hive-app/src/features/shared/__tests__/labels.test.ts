import {
  ACTIVITY_KIND_LABEL,
  ACTOR_LABEL,
  CASE_ACTION_CONFIRMATION,
  CASE_ACTION_DONE,
  INTAKE_REFUSAL_WORDING,
  OWNER_LABEL,
  REQUEST_STATUS_PRESENTATION,
  caseActionLabel,
  derivedGuidance,
  formatServerDate,
  recordedThroughLabel,
} from '../labels';

describe('server date formatting', () => {
  it('formats a date column without shifting it by timezone', () => {
    // The bug this guards: new Date('2026-08-10') is UTC midnight, which
    // renders as August 9 anywhere west of Greenwich. A date the server
    // recorded must not move because of where the phone is.
    expect(formatServerDate('2026-08-10')).toBe('August 10, 2026');
    expect(formatServerDate('2026-01-01')).toBe('January 1, 2026');
    expect(formatServerDate('2026-12-31')).toBe('December 31, 2026');
  });

  it('formats a timestamptz to its server date', () => {
    expect(formatServerDate('2026-08-14T13:45:00Z')).toBe('August 14, 2026');
  });

  it('returns unparseable input unchanged rather than inventing a date', () => {
    expect(formatServerDate('not-a-date')).toBe('not-a-date');
    expect(formatServerDate('2026-13-01')).toBe('2026-13-01');
  });
});

describe('staleness wording', () => {
  it('states what the data is recorded THROUGH, never a device clock reading', () => {
    expect(recordedThroughLabel('2026-08-14T13:45:00Z')).toBe('Recorded through August 14, 2026');
  });

  it('makes no currency claim at all when there is nothing to be current about', () => {
    expect(recordedThroughLabel(null)).toBeNull();
  });
});

describe('label vocabularies', () => {
  it('covers every membership role', () => {
    for (const role of ['client_user', 'intake', 'preparer', 'reviewer', 'approver'] as const) {
      expect(OWNER_LABEL[role]).toBeTruthy();
      expect(ACTOR_LABEL[role]).toBeTruthy();
    }
  });

  it('labels the system actor without naming a person', () => {
    expect(ACTOR_LABEL.system).toBe('HIVE');
  });

  it('covers every request status and activity kind', () => {
    for (const status of ['OPEN', 'ANSWERED', 'CLOSED', 'EXPIRED'] as const) {
      expect(REQUEST_STATUS_PRESENTATION[status].label).toBeTruthy();
    }
    for (const kind of [
      'case.status_changed',
      'request.opened',
      'request.answered',
      'request.closed',
      'request.expired',
    ] as const) {
      expect(ACTIVITY_KIND_LABEL[kind]).toBeTruthy();
    }
  });

  it('never renders a raw enum value to a client', () => {
    for (const label of Object.values(ACTIVITY_KIND_LABEL)) {
      expect(label).not.toContain('.');
      expect(label).not.toContain('_');
    }
  });
});

describe('derived guidance (WO-013)', () => {
  it('names what waits on the client from the open requests, and who holds the next move by status', () => {
    expect(derivedGuidance('EVIDENCE_PENDING', 2)).toEqual({
      attention: '2 requests are waiting for your response.',
      nextAction: { summary: 'Respond to the open requests.', ownerRole: 'client_user' },
    });
    expect(derivedGuidance('EVIDENCE_PENDING', 1).attention).toBe(
      'One request is waiting for your response.',
    );
    expect(derivedGuidance('EVIDENCE_PENDING', 0)).toEqual({
      attention: null,
      nextAction: { summary: 'Honeybee is preparing the case.', ownerRole: 'preparer' },
    });
    expect(derivedGuidance('DRAFT', 0).nextAction?.ownerRole).toBe('intake');
    expect(derivedGuidance('INTAKE_RECORDED', 0).nextAction?.ownerRole).toBe('intake');
    expect(derivedGuidance('IN_REVIEW', 0).nextAction?.ownerRole).toBe('reviewer');
    expect(derivedGuidance('APPROVAL_PENDING', 0).nextAction?.ownerRole).toBe('approver');
    expect(derivedGuidance('HOLD', 0).attention).toBe('The case is on hold.');
    expect(derivedGuidance('APPROVED', 3)).toEqual({ attention: null, nextAction: null });
  });

  it('labels the intake trail entry and every case action in client language', () => {
    expect(ACTIVITY_KIND_LABEL['case.intake_recorded']).toBe('Received by Honeybee');
    for (const action of [
      'record_intake',
      'discard_draft',
      'add_request',
      'close_request',
    ] as const) {
      expect(caseActionLabel(action, 'DRAFT')).toBeTruthy();
      expect(CASE_ACTION_CONFIRMATION[action].title).toBeTruthy();
      expect(CASE_ACTION_DONE[action].title).toBeTruthy();
    }
    for (const refusal of [
      'title_missing',
      'title_too_long',
      'detail_too_long',
      'invalid_due',
    ] as const) {
      expect(INTAKE_REFUSAL_WORDING[refusal].title).toBeTruthy();
    }
  });
});
