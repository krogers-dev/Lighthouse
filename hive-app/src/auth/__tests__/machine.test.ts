import {
  IllegalTransitionError,
  createAuthReducer,
  initialAuthState,
  type AuthEvent,
  type AuthState,
} from '../machine';
import { FORGED_MEMBERSHIP_ID, actorAal1, membershipA1, membershipA2 } from './fixtures';

const devReduce = createAuthReducer({ failMode: 'throw' });

function drive(state: AuthState, ...events: AuthEvent[]): AuthState {
  return events.reduce((s, e) => devReduce(s, e), state);
}

const booting = initialAuthState();

const signedOut = drive(booting, { type: 'BOOTED_NO_SESSION' });

const firstFactor = drive(signedOut, {
  type: 'SIGN_IN_STARTED',
  email: 'client.owner@example.invalid',
});

const authorized = drive(booting, {
  type: 'SCOPES_LOADED',
  actor: actorAal1,
  memberships: [membershipA1],
});

const selectScope = drive(booting, {
  type: 'SCOPES_LOADED',
  actor: actorAal1,
  memberships: [membershipA1, membershipA2],
});

const quarantined = drive(booting, { type: 'STORAGE_FAILURE', code: 'storage' });

describe('boot transitions', () => {
  it('starts in booting', () => {
    expect(booting.name).toBe('booting');
  });

  it('boots to signed_out(initial) with no session', () => {
    expect(signedOut).toMatchObject({ name: 'signed_out', reason: 'initial' });
  });

  it('boots to signed_out(offline) when the session cannot be verified offline', () => {
    expect(drive(booting, { type: 'BOOTED_OFFLINE' })).toMatchObject({
      name: 'signed_out',
      reason: 'offline',
    });
  });

  it('boots directly to authorized with exactly one membership (scope auto-bound)', () => {
    expect(authorized.name).toBe('authorized');
    if (authorized.name === 'authorized') {
      expect(authorized.scope.entityId).toBe(membershipA1.entityId);
      expect(authorized.scope.membershipId).toBe(membershipA1.membershipId);
    }
  });

  it('forces explicit selection when more than one membership exists', () => {
    expect(selectScope.name).toBe('select_scope');
  });

  it('treats zero memberships as NO_ACCESS → signed_out(no_access)', () => {
    expect(drive(booting, { type: 'NO_ACCESS' })).toMatchObject({
      name: 'signed_out',
      reason: 'no_access',
    });
  });

  it('routes to MFA before scopes when required', () => {
    expect(drive(booting, { type: 'MFA_CHALLENGE_REQUIRED' }).name).toBe('mfa_required');
  });
});

describe('sign-in flow', () => {
  it('walks email → otp sent → verifying → authorized', () => {
    const sent = drive(firstFactor, { type: 'OTP_REQUESTED' });
    expect(sent).toMatchObject({ name: 'first_factor', otpSent: true, verifying: false });
    const verifying = drive(sent, { type: 'OTP_SUBMITTED' });
    expect(verifying).toMatchObject({ name: 'first_factor', verifying: true });
    const done = drive(verifying, {
      type: 'SCOPES_LOADED',
      actor: actorAal1,
      memberships: [membershipA1],
    });
    expect(done.name).toBe('authorized');
  });

  it('keeps a safe notice on OTP request failure', () => {
    const failed = drive(firstFactor, { type: 'OTP_REQUEST_FAILED', code: 'network' });
    expect(failed).toMatchObject({ name: 'first_factor', notice: 'network' });
  });

  it('returns to otp entry on first-factor failure', () => {
    const failed = drive(
      firstFactor,
      { type: 'OTP_REQUESTED' },
      { type: 'OTP_SUBMITTED' },
      { type: 'FIRST_FACTOR_FAILED', code: 'auth_invalid' },
    );
    expect(failed).toMatchObject({
      name: 'first_factor',
      otpSent: true,
      verifying: false,
      notice: 'auth_invalid',
    });
  });

  it('supports MFA challenge after first factor', () => {
    const mfa = drive(
      firstFactor,
      { type: 'OTP_REQUESTED' },
      { type: 'OTP_SUBMITTED' },
      { type: 'MFA_CHALLENGE_REQUIRED' },
    );
    expect(mfa.name).toBe('mfa_required');
    const verifying = drive(mfa, { type: 'MFA_SUBMITTED' });
    expect(verifying).toMatchObject({ name: 'mfa_required', verifying: true });
    const failed = drive(verifying, { type: 'MFA_FAILED', code: 'auth_invalid' });
    expect(failed).toMatchObject({
      name: 'mfa_required',
      verifying: false,
      notice: 'auth_invalid',
    });
    const done = drive(
      failed,
      { type: 'MFA_SUBMITTED' },
      { type: 'SCOPES_LOADED', actor: actorAal1, memberships: [membershipA1, membershipA2] },
    );
    expect(done.name).toBe('select_scope');
  });

  it('allows a safe cancel back to signed_out from first_factor', () => {
    expect(drive(firstFactor, { type: 'RETURN_TO_SIGNED_OUT' }).name).toBe('signed_out');
  });
});

describe('first-time TOTP enrollment (P1-3)', () => {
  const enrollment = {
    factorId: 'factor-synthetic',
    secret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
    qrSvg: '<svg />',
    uri: null,
  };
  const mfa = drive(
    firstFactor,
    { type: 'OTP_REQUESTED' },
    { type: 'OTP_SUBMITTED' },
    { type: 'MFA_CHALLENGE_REQUIRED' },
  );

  it('carries the enrollment payload into mfa_required context', () => {
    const enrolling = drive(mfa, { type: 'MFA_ENROLLMENT_REQUIRED', enrollment });
    expect(enrolling).toMatchObject({ name: 'mfa_required', verifying: false, enrollment });
  });

  it('preserves enrollment across submit and a wrong-code failure', () => {
    const failed = drive(
      mfa,
      { type: 'MFA_ENROLLMENT_REQUIRED', enrollment },
      { type: 'MFA_SUBMITTED' },
      { type: 'MFA_FAILED', code: 'auth_invalid' },
    );
    expect(failed).toMatchObject({
      name: 'mfa_required',
      verifying: false,
      notice: 'auth_invalid',
      enrollment,
    });
  });

  it('accepts setup failures outside verification as a safe notice', () => {
    const failed = drive(mfa, { type: 'MFA_FAILED', code: 'network' });
    expect(failed).toMatchObject({ name: 'mfa_required', verifying: false, notice: 'network' });
  });

  it('rejects enrollment arriving while a code is being verified', () => {
    const verifying = drive(mfa, { type: 'MFA_SUBMITTED' });
    expect(() => devReduce(verifying, { type: 'MFA_ENROLLMENT_REQUIRED', enrollment })).toThrow(
      IllegalTransitionError,
    );
  });

  it('clears enrollment (with the whole context) on cancel to sign-out', () => {
    const enrolling = drive(mfa, { type: 'MFA_ENROLLMENT_REQUIRED', enrollment });
    const out = drive(enrolling, { type: 'SIGN_OUT_REQUESTED', reason: 'user' });
    expect(out).toEqual({ name: 'signing_out', reason: 'user' });
  });
});

describe('scope selection and switching', () => {
  it('binds the selected membership', () => {
    const bound = drive(selectScope, {
      type: 'SCOPE_SELECTED',
      membershipId: membershipA2.membershipId,
    });
    expect(bound.name).toBe('authorized');
    if (bound.name === 'authorized') {
      expect(bound.scope.entityId).toBe(membershipA2.entityId);
    }
  });

  it('rejects a forged membership id as an illegal transition', () => {
    expect(() =>
      devReduce(selectScope, { type: 'SCOPE_SELECTED', membershipId: FORGED_MEMBERSHIP_ID }),
    ).toThrow(IllegalTransitionError);
  });

  it('returns to select_scope on scope switch, clearing the bound scope but keeping identity', () => {
    const multiAuthorized = drive(selectScope, {
      type: 'SCOPE_SELECTED',
      membershipId: membershipA1.membershipId,
    });
    const back = drive(multiAuthorized, { type: 'SCOPE_SWITCH_REQUESTED' });
    expect(back.name).toBe('select_scope');
    expect(back).not.toHaveProperty('scope');
    if (back.name === 'select_scope') {
      expect(back.memberships).toHaveLength(2);
    }
  });
});

describe('sign-out sequence', () => {
  it('authorized → signing_out carries no actor, scope, or memberships', () => {
    const signingOut = drive(authorized, { type: 'SIGN_OUT_REQUESTED', reason: 'user' });
    expect(signingOut.name).toBe('signing_out');
    expect(signingOut).not.toHaveProperty('actor');
    expect(signingOut).not.toHaveProperty('scope');
    expect(signingOut).not.toHaveProperty('memberships');
  });

  it('completes to signed_out with the mapped reason', () => {
    expect(
      drive(
        authorized,
        { type: 'SIGN_OUT_REQUESTED', reason: 'expired' },
        { type: 'SIGN_OUT_SUCCEEDED' },
      ),
    ).toMatchObject({ name: 'signed_out', reason: 'expired' });
    expect(
      drive(
        authorized,
        { type: 'SIGN_OUT_REQUESTED', reason: 'user' },
        { type: 'SIGN_OUT_SUCCEEDED' },
      ),
    ).toMatchObject({ name: 'signed_out', reason: 'signed_out' });
  });

  it('storage deletion failure during sign-out lands in quarantine, not signed_out', () => {
    const q = drive(
      authorized,
      { type: 'SIGN_OUT_REQUESTED', reason: 'user' },
      { type: 'SIGN_OUT_STORAGE_FAILED' },
    );
    expect(q.name).toBe('storage_quarantined');
  });

  it('is reachable from every session-holding state', () => {
    for (const from of [
      authorized,
      selectScope,
      firstFactor,
      drive(booting, { type: 'MFA_CHALLENGE_REQUIRED' }),
    ]) {
      expect(drive(from, { type: 'SIGN_OUT_REQUESTED', reason: 'user' }).name).toBe('signing_out');
    }
  });
});

describe('storage quarantine', () => {
  it('is reachable from any non-fatal state', () => {
    for (const from of [booting, signedOut, firstFactor, selectScope, authorized]) {
      expect(drive(from, { type: 'STORAGE_FAILURE', code: 'storage' }).name).toBe(
        'storage_quarantined',
      );
    }
  });

  it('retains no protected context', () => {
    const q = drive(authorized, { type: 'STORAGE_FAILURE', code: 'storage' });
    expect(q).not.toHaveProperty('actor');
    expect(q).not.toHaveProperty('scope');
  });

  it('absorbs ordinary events (no generic retry can exit quarantine)', () => {
    for (const event of [
      { type: 'BOOTED_NO_SESSION' },
      { type: 'SIGN_IN_STARTED', email: 'client.owner@example.invalid' },
      { type: 'SCOPES_LOADED', actor: actorAal1, memberships: [membershipA1] },
      { type: 'SIGN_OUT_REQUESTED', reason: 'user' },
      { type: 'SIGN_OUT_SUCCEEDED' },
    ] as AuthEvent[]) {
      expect(devReduce(quarantined, event).name).toBe('storage_quarantined');
    }
  });

  it('only a verified scrub exits to signed_out(scrubbed)', () => {
    const out = drive(
      quarantined,
      { type: 'QUARANTINE_SCRUB_STARTED' },
      { type: 'QUARANTINE_SCRUB_SUCCEEDED' },
    );
    expect(out).toMatchObject({ name: 'signed_out', reason: 'scrubbed' });
  });

  it('a failed scrub stays quarantined and reports the failure', () => {
    const still = drive(
      quarantined,
      { type: 'QUARANTINE_SCRUB_STARTED' },
      { type: 'QUARANTINE_SCRUB_FAILED' },
    );
    expect(still).toMatchObject({
      name: 'storage_quarantined',
      scrubInProgress: false,
      lastAttemptFailed: true,
    });
  });
});

describe('fatal', () => {
  it('is reachable from anywhere and absorbs everything', () => {
    const fatal = drive(authorized, { type: 'FATAL', code: 'config' });
    expect(fatal).toMatchObject({ name: 'fatal', code: 'config' });
    for (const event of [
      { type: 'BOOTED_NO_SESSION' },
      { type: 'STORAGE_FAILURE', code: 'storage' },
      { type: 'SIGN_OUT_REQUESTED', reason: 'user' },
    ] as AuthEvent[]) {
      expect(devReduce(fatal, event)).toBe(fatal);
    }
  });
});

describe('illegal transitions', () => {
  const illegalPairs: [AuthState, AuthEvent][] = [
    [signedOut, { type: 'SCOPE_SELECTED', membershipId: membershipA1.membershipId }],
    [signedOut, { type: 'SIGN_OUT_SUCCEEDED' }],
    [signedOut, { type: 'OTP_REQUESTED' }],
    [authorized, { type: 'SIGN_OUT_SUCCEEDED' }],
    [authorized, { type: 'OTP_SUBMITTED' }],
    [authorized, { type: 'QUARANTINE_SCRUB_SUCCEEDED' }],
    [booting, { type: 'SIGN_IN_STARTED', email: 'client.owner@example.invalid' }],
    [firstFactor, { type: 'SCOPE_SWITCH_REQUESTED' }],
    [signedOut, { type: 'SCOPES_LOADED', actor: actorAal1, memberships: [membershipA1] }],
    [
      signedOut,
      {
        type: 'MFA_ENROLLMENT_REQUIRED',
        enrollment: { factorId: 'f', secret: 's', qrSvg: null, uri: null },
      },
    ],
    [
      authorized,
      {
        type: 'MFA_ENROLLMENT_REQUIRED',
        enrollment: { factorId: 'f', secret: 's', qrSvg: null, uri: null },
      },
    ],
  ];

  it.each(illegalPairs.map(([s, e]) => [s.name, e.type, s, e] as const))(
    'throws in development for %s × %s',
    (_s, _e, state, event) => {
      expect(() => devReduce(state, event)).toThrow(IllegalTransitionError);
    },
  );

  it('fails closed in production: state unchanged and the violation reported', () => {
    const onIllegal = jest.fn();
    const prodReduce = createAuthReducer({ failMode: 'closed', onIllegal });
    const result = prodReduce(signedOut, { type: 'SIGN_OUT_SUCCEEDED' });
    expect(result).toBe(signedOut);
    expect(onIllegal).toHaveBeenCalledWith('signed_out', 'SIGN_OUT_SUCCEEDED');
  });

  it('rejects SCOPES_LOADED with an empty membership list even where the event is legal', () => {
    expect(() =>
      devReduce(booting, { type: 'SCOPES_LOADED', actor: actorAal1, memberships: [] }),
    ).toThrow(IllegalTransitionError);
  });
});

describe('cancel during verification (review P2-7)', () => {
  it('is illegal once OTP verification is in flight', () => {
    const verifying = drive(firstFactor, { type: 'OTP_REQUESTED' }, { type: 'OTP_SUBMITTED' });
    expect(() => devReduce(verifying, { type: 'RETURN_TO_SIGNED_OUT' })).toThrow(
      IllegalTransitionError,
    );
  });
});
