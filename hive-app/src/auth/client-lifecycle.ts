/** Single Supabase client behind the auth lifecycle controller.
 *
 * The controller is the only owner. During sign-out, acquisition freezes
 * first; the client is disposed only after storage deletion has been
 * read-back verified — never nulled or recreated early.
 */
import type { UserId } from '@/core/ids';
import type { AuthenticatorAssuranceLevel, Membership } from '@/tenancy/types';

export interface SessionInfo {
  readonly userId: UserId;
  readonly aal: AuthenticatorAssuranceLevel;
  /** Milliseconds since epoch, when known. */
  readonly expiresAt: number | null;
}

export type AuthListenerEvent = 'SIGNED_OUT' | 'TOKEN_REFRESHED' | 'OTHER';

/** Narrow port over the auth surface the controller needs. Implemented for
 * supabase-js in src/data/supabase/client.ts and by fakes in tests. */
export interface AuthGateway {
  /** Reads the locally persisted session. Storage problems surface as
   * QuarantineRequiredError from the storage adapter. */
  getSession(): Promise<SessionInfo | null>;
  /** Sends an email OTP with shouldCreateUser: false (invite-only). */
  requestOtp(email: string): Promise<void>;
  verifyOtp(email: string, token: string): Promise<SessionInfo>;
  /** Returns the verified TOTP factor id, when one is enrolled. */
  listTotpFactorId(): Promise<string | null>;
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

  constructor(private readonly factory: () => ClientBundle) {}

  get currentPhase(): LifecyclePhase {
    return this.phase;
  }

  /** Constructs the single client. Illegal while one is active or frozen. */
  create(): ClientBundle {
    if (this.phase === 'active' || this.phase === 'frozen') {
      throw new Error('Auth client already exists');
    }
    this.bundle = this.factory();
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
