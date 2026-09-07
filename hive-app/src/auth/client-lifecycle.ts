/** Single Supabase client behind the auth lifecycle controller.
 *
 * The controller is the only owner. During sign-out, acquisition freezes
 * first; the client is disposed only after storage deletion has been
 * read-back verified — never nulled or recreated early.
 */
import type { UserId } from '@/core/ids';
import type { AuthenticatorAssuranceLevel, Membership } from '@/tenancy/types';

import type { QuarantineRequiredError } from './secure-store-adapter';

export interface SessionInfo {
  readonly userId: UserId;
  readonly aal: AuthenticatorAssuranceLevel;
  /** Milliseconds since epoch, when known. */
  readonly expiresAt: number | null;
}

export type AuthListenerEvent = 'SIGNED_OUT' | 'TOKEN_REFRESHED' | 'OTHER';

export interface TotpFactors {
  readonly verifiedId: string | null;
  readonly unverifiedIds: readonly string[];
}

/** Setup material for first-time TOTP enrollment. The secret and QR exist
 * in memory only, are never persisted or logged (the diagnostics allowlist
 * cannot carry them), and are discarded on verification or sign-out. */
export interface TotpEnrollment {
  readonly factorId: string;
  readonly secret: string;
  readonly qrSvg: string | null;
  readonly uri: string | null;
}

/** Narrow port over the auth surface the controller needs. Implemented for
 * supabase-js in src/data/supabase/client.ts and by fakes in tests. */
export interface AuthGateway {
  /** Reads the locally persisted session, refreshing it when its access
   * token has lapsed. Storage problems surface as QuarantineRequiredError
   * from the storage adapter; a refresh the auth server definitively
   * rejects surfaces as SessionExpiredError; an unreachable auth server
   * surfaces as SessionOfflineError. */
  getSession(): Promise<SessionInfo | null>;
  /** Sends an email OTP with shouldCreateUser: false (invite-only). */
  requestOtp(email: string): Promise<void>;
  verifyOtp(email: string, token: string): Promise<SessionInfo>;
  listTotpFactors(): Promise<TotpFactors>;
  /** Begins first-time TOTP enrollment (mfa.enroll). */
  enrollTotp(): Promise<TotpEnrollment>;
  /** Best-effort removal of an abandoned unverified factor. */
  unenrollTotp(factorId: string): Promise<void>;
  verifyTotp(factorId: string, code: string): Promise<SessionInfo>;
  /** Server-side revocation. Failure must never preserve local access. */
  signOutRemote(): Promise<void>;
  startAutoRefresh(): void;
  stopAutoRefresh(): void;
  onAuthStateChange(listener: (event: AuthListenerEvent) => void): () => void;
}

export interface MembershipGateway {
  /** Server-confirmed memberships for the signed-in user. */
  listMemberships(userId: UserId): Promise<Membership[]>;
}

export interface ClientBundle {
  readonly auth: AuthGateway;
  readonly memberships: MembershipGateway;
  /** Releases underlying resources. Idempotent. */
  dispose(): void;
}

/** What a bundle can tell the controller on its own initiative. Handed to
 * the factory at creation because the auth library reads the store the
 * moment it is constructed, before any controller call. */
export interface BundleEvents {
  /** The auth library's own reader (its recovery read at construction,
   * the initial-session emitter, the refresh tick, a data call's token
   * lookup) met a storage failure the controller has not seen through a
   * call of its own. The bundle's storage bridge has already closed that
   * bundle's gate and shown the library "no session"; the controller takes
   * the quarantine transition from here (find 46). Called at most once per
   * bundle. */
  onStorageQuarantine(error: QuarantineRequiredError): void;
}

/** The stored session exists but the auth server definitively REJECTED its
 * refresh (revoked, rotated, or expired refresh token): a dead session.
 * Boot takes the expiry branch — local cleanup, then signed_out with the
 * "session ended" reason — never fatal. Found by the 2026-09-06 review:
 * before this, a dead session at boot landed on the fatal screen. */
export class SessionExpiredError extends Error {
  constructor() {
    super('Stored session is dead: the auth server rejected its refresh');
    this.name = 'SessionExpiredError';
  }
}

/** The stored session could not be refreshed because the auth server was
 * unreachable: an OFFLINE launch, never an expired one. */
export class SessionOfflineError extends Error {
  constructor() {
    super('Stored session could not be refreshed: auth server unreachable');
    this.name = 'SessionOfflineError';
  }
}

export class ClientFrozenError extends Error {
  constructor() {
    super('Auth client acquisition is frozen');
    this.name = 'ClientFrozenError';
  }
}

export type LifecyclePhase = 'empty' | 'active' | 'frozen' | 'disposed';

export class ClientLifecycle {
  private bundle: ClientBundle | null = null;
  private phase: LifecyclePhase = 'empty';

  constructor(private readonly factory: (events: BundleEvents) => ClientBundle) {}

  get currentPhase(): LifecyclePhase {
    return this.phase;
  }

  /** Constructs the single client. Illegal while one is active or frozen. */
  create(events: BundleEvents): ClientBundle {
    if (this.phase === 'active' || this.phase === 'frozen') {
      throw new Error('Auth client already exists');
    }
    this.bundle = this.factory(events);
    this.phase = 'active';
    return this.bundle;
  }

  acquire(): ClientBundle {
    if (this.phase !== 'active' || this.bundle === null) {
      throw new ClientFrozenError();
    }
    return this.bundle;
  }

  freeze(): void {
    if (this.phase === 'active') {
      this.phase = 'frozen';
    }
  }

  /** Dispose after verified storage deletion. Never called early. */
  dispose(): void {
    this.bundle?.dispose();
    this.bundle = null;
    this.phase = 'disposed';
  }
}
