/** Pure auth state machine.
 *
 * Specification: docs/auth-state-machine.md. No side effects, no timers, no
 * I/O; the AuthController drives it. Illegal transitions throw in
 * development (`failMode: 'throw'`) and fail closed in production
 * (`failMode: 'closed'`): the state is returned unchanged and the violation
 * is reported through `onIllegal`, so no event can ever widen access.
 */
import type { SafeErrorCode } from '@/core/errors';
import type { MembershipId } from '@/core/ids';
import { scopeKeyFromMembership, type ScopeKey } from '@/tenancy/scope-key';
import type { Actor, Membership } from '@/tenancy/types';

export type SignedOutReason =
  | 'initial'
  | 'signed_out'
  | 'expired'
  | 'scrubbed'
  | 'no_access'
  | 'offline';

export type SignOutReason = 'user' | 'expired' | 'identity_switch';

export type AuthState =
  | { name: 'booting' }
  | { name: 'signed_out'; reason: SignedOutReason }
  | {
      name: 'first_factor';
      email: string;
      otpSent: boolean;
      verifying: boolean;
      notice?: SafeErrorCode;
    }
  | { name: 'mfa_required'; verifying: boolean; notice?: SafeErrorCode }
  | { name: 'select_scope'; actor: Actor; memberships: readonly Membership[] }
  | {
      name: 'authorized';
      actor: Actor;
      scope: ScopeKey;
      memberships: readonly Membership[];
    }
  | { name: 'signing_out'; reason: SignOutReason }
  | { name: 'storage_quarantined'; scrubInProgress: boolean; lastAttemptFailed: boolean }
  | { name: 'fatal'; code: SafeErrorCode };

export type AuthStateName = AuthState['name'];

export type AuthEvent =
  | { type: 'BOOTED_NO_SESSION' }
  | { type: 'BOOTED_OFFLINE' }
  | { type: 'BOOTED_EXPIRED' }
  | { type: 'SCOPES_LOADED'; actor: Actor; memberships: readonly Membership[] }
  | { type: 'NO_ACCESS' }
  | { type: 'MFA_CHALLENGE_REQUIRED' }
  | { type: 'SIGN_IN_STARTED'; email: string }
  | { type: 'OTP_REQUESTED' }
  | { type: 'OTP_REQUEST_FAILED'; code: SafeErrorCode }
  | { type: 'OTP_SUBMITTED' }
  | { type: 'FIRST_FACTOR_FAILED'; code: SafeErrorCode }
  | { type: 'MFA_SUBMITTED' }
  | { type: 'MFA_FAILED'; code: SafeErrorCode }
  | { type: 'SCOPE_SELECTED'; membershipId: MembershipId }
  | { type: 'SCOPE_SWITCH_REQUESTED' }
  | { type: 'SIGN_OUT_REQUESTED'; reason: SignOutReason }
  | { type: 'RETURN_TO_SIGNED_OUT' }
  | { type: 'SIGN_OUT_SUCCEEDED' }
  | { type: 'SIGN_OUT_STORAGE_FAILED' }
  | { type: 'STORAGE_FAILURE'; code: SafeErrorCode }
  | { type: 'QUARANTINE_SCRUB_STARTED' }
  | { type: 'QUARANTINE_SCRUB_SUCCEEDED' }
  | { type: 'QUARANTINE_SCRUB_FAILED' }
  | { type: 'FATAL'; code: SafeErrorCode };

export class IllegalTransitionError extends Error {
  constructor(
    readonly fromState: AuthStateName,
    readonly eventType: AuthEvent['type'],
  ) {
    super(`Illegal auth transition: ${eventType} in ${fromState}`);
    this.name = 'IllegalTransitionError';
  }
}

export interface AuthReducerOptions {
  failMode: 'throw' | 'closed';
  onIllegal?: (fromState: AuthStateName, eventType: AuthEvent['type']) => void;
}

export function initialAuthState(): AuthState {
  return { name: 'booting' };
}

const SIGNED_OUT_REASON_FOR: Record<SignOutReason, SignedOutReason> = {
  user: 'signed_out',
  identity_switch: 'signed_out',
  expired: 'expired',
};

function scopesLoaded(actor: Actor, memberships: readonly Membership[]): AuthState | null {
  if (memberships.length === 0) {
    // Zero memberships must arrive as NO_ACCESS after a server sign-out.
    return null;
  }
  const first = memberships[0];
  if (memberships.length === 1 && first) {
    return {
      name: 'authorized',
      actor,
      scope: scopeKeyFromMembership(first),
      memberships,
    };
  }
  return { name: 'select_scope', actor, memberships };
}

/** The pure transition function; returns the next state or null when the
 * event is illegal in the current state. */
function transition(state: AuthState, event: AuthEvent): AuthState | null {
  // Absorbing states first.
  if (state.name === 'fatal') {
    return state;
  }
  if (event.type === 'FATAL') {
    return { name: 'fatal', code: event.code };
  }
  if (state.name === 'storage_quarantined') {
    switch (event.type) {
      case 'QUARANTINE_SCRUB_STARTED':
        return { name: 'storage_quarantined', scrubInProgress: true, lastAttemptFailed: false };
      case 'QUARANTINE_SCRUB_SUCCEEDED':
        return { name: 'signed_out', reason: 'scrubbed' };
      case 'QUARANTINE_SCRUB_FAILED':
        return { name: 'storage_quarantined', scrubInProgress: false, lastAttemptFailed: true };
      default:
        // Quarantine absorbs everything else: no generic retry, no session
        // evaluation, no protected UI.
        return state;
    }
  }
  if (event.type === 'STORAGE_FAILURE') {
    return { name: 'storage_quarantined', scrubInProgress: false, lastAttemptFailed: false };
  }

  switch (state.name) {
    case 'booting':
      switch (event.type) {
        case 'BOOTED_NO_SESSION':
          return { name: 'signed_out', reason: 'initial' };
        case 'BOOTED_OFFLINE':
          return { name: 'signed_out', reason: 'offline' };
        case 'BOOTED_EXPIRED':
          return { name: 'signed_out', reason: 'expired' };
        case 'NO_ACCESS':
          return { name: 'signed_out', reason: 'no_access' };
        case 'MFA_CHALLENGE_REQUIRED':
          return { name: 'mfa_required', verifying: false };
        case 'SCOPES_LOADED':
          return scopesLoaded(event.actor, event.memberships);
        default:
          return null;
      }
    case 'signed_out':
      switch (event.type) {
        case 'SIGN_IN_STARTED':
          return { name: 'first_factor', email: event.email, otpSent: false, verifying: false };
        default:
          return null;
      }
    case 'first_factor':
      switch (event.type) {
        case 'OTP_REQUESTED':
          return { ...state, otpSent: true, verifying: false, notice: undefined };
        case 'OTP_REQUEST_FAILED':
          return { ...state, verifying: false, notice: event.code };
        case 'OTP_SUBMITTED':
          return state.otpSent ? { ...state, verifying: true, notice: undefined } : null;
        case 'FIRST_FACTOR_FAILED':
          return state.verifying ? { ...state, verifying: false, notice: event.code } : null;
        case 'MFA_CHALLENGE_REQUIRED':
          return state.verifying ? { name: 'mfa_required', verifying: false } : null;
        case 'SCOPES_LOADED':
          return state.verifying ? scopesLoaded(event.actor, event.memberships) : null;
        case 'NO_ACCESS':
          return { name: 'signed_out', reason: 'no_access' };
        case 'RETURN_TO_SIGNED_OUT':
          // Safe back/cancel exists only before verification is in flight;
          // during verification a session could land after the UI left.
          return state.verifying ? null : { name: 'signed_out', reason: 'signed_out' };
        case 'SIGN_OUT_REQUESTED':
          return { name: 'signing_out', reason: event.reason };
        default:
          return null;
      }
    case 'mfa_required':
      switch (event.type) {
        case 'MFA_SUBMITTED':
          return { name: 'mfa_required', verifying: true };
        case 'MFA_FAILED':
          return state.verifying ? { name: 'mfa_required', verifying: false, notice: event.code } : null;
        case 'SCOPES_LOADED':
          return state.verifying ? scopesLoaded(event.actor, event.memberships) : null;
        case 'NO_ACCESS':
          return { name: 'signed_out', reason: 'no_access' };
        case 'SIGN_OUT_REQUESTED':
          return { name: 'signing_out', reason: event.reason };
        default:
          return null;
      }
    case 'select_scope':
      switch (event.type) {
        case 'SCOPE_SELECTED': {
          const membership = state.memberships.find(
            (m) => m.membershipId === event.membershipId,
          );
          if (!membership) {
            // Forged or stale membership id: illegal, never a bind.
            return null;
          }
          return {
            name: 'authorized',
            actor: state.actor,
            scope: scopeKeyFromMembership(membership),
            memberships: state.memberships,
          };
        }
        case 'SIGN_OUT_REQUESTED':
          return { name: 'signing_out', reason: event.reason };
        default:
          return null;
      }
    case 'authorized':
      switch (event.type) {
        case 'SCOPE_SWITCH_REQUESTED':
          return { name: 'select_scope', actor: state.actor, memberships: state.memberships };
        case 'SIGN_OUT_REQUESTED':
          return { name: 'signing_out', reason: event.reason };
        default:
          return null;
      }
    case 'signing_out':
      switch (event.type) {
        case 'SIGN_OUT_SUCCEEDED':
          return { name: 'signed_out', reason: SIGNED_OUT_REASON_FOR[state.reason] };
        case 'SIGN_OUT_STORAGE_FAILED':
          return { name: 'storage_quarantined', scrubInProgress: false, lastAttemptFailed: false };
        default:
          return null;
      }
  }
}

export type AuthReducer = (state: AuthState, event: AuthEvent) => AuthState;

export function createAuthReducer(options: AuthReducerOptions): AuthReducer {
  return (state, event) => {
    const next = transition(state, event);
    if (next === null) {
      options.onIllegal?.(state.name, event.type);
      if (options.failMode === 'throw') {
        throw new IllegalTransitionError(state.name, event.type);
      }
      return state;
    }
    return next;
  };
}
