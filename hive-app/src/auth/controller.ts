/** AuthController — the effectful side of the auth machine.
 *
 * Owns the single Supabase client (via ClientLifecycle), the auth epoch,
 * and one serialized operation queue through which boot, sign-in, refresh
 * control, expiry, sign-out, and quarantine recovery all run. Sequences are
 * specified in docs/auth-state-machine.md; the reducer in machine.ts is the
 * only thing that changes state.
 */
import type { Clock } from '@/core/clock';
import type { Diagnostics } from '@/core/diagnostics';
import { toSafeError } from '@/core/errors';
import type { MembershipId } from '@/core/ids';
import type { ClearReason, ScopedRegistry } from '@/tenancy/clearing';
import { membershipsRequireAal2, type Membership } from '@/tenancy/types';

import {
  ClientLifecycle,
  type ClientBundle,
  type SessionInfo,
} from './client-lifecycle';
import type { InstallMarker } from './install-marker';
import {
  createAuthReducer,
  initialAuthState,
  type AuthEvent,
  type AuthReducer,
  type AuthState,
  type SignOutReason,
} from './machine';
import { EpochGate } from './epoch';
import { QuarantineRequiredError } from './secure-store-adapter';

export interface SessionStorage {
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
  delete(): Promise<void>;
  scrubAll(): Promise<void>;
  hasResidue(): Promise<boolean>;
}

export interface AuthControllerDeps {
  createBundle: () => ClientBundle;
  storage: SessionStorage;
  marker: InstallMarker;
  registry: ScopedRegistry;
  diagnostics: Diagnostics;
  clock: Clock;
  /** 'throw' in development, 'closed' in production builds. */
  failMode: 'throw' | 'closed';
}

export type AppStatus = 'active' | 'background' | 'inactive' | 'unknown' | 'extension';

const SESSION_HOLDING_STATES: readonly AuthState['name'][] = [
  'authorized',
  'select_scope',
  'mfa_required',
  'first_factor',
];

type RouteOrigin = 'boot' | 'first_factor' | 'mfa';

export class AuthController {
  private state: AuthState = initialAuthState();
  private readonly listeners = new Set<(state: AuthState) => void>();
  private readonly epoch = new EpochGate();
  private readonly lifecycle: ClientLifecycle;
  private readonly reduce: AuthReducer;
  private queue: Promise<void> = Promise.resolve();
  private unsubscribeAuth: (() => void) | null = null;
  private heldBundle: ClientBundle | null = null;
  private pendingEmail: string | null = null;

  constructor(private readonly deps: AuthControllerDeps) {
    this.lifecycle = new ClientLifecycle(deps.createBundle);
    this.reduce = createAuthReducer({
      failMode: deps.failMode,
      onIllegal: (fromState, eventType) =>
        deps.diagnostics.record('auth_illegal_transition', {
          fromState,
          event: eventType,
        }),
    });
  }

  getState(): AuthState {
    return this.state;
  }

  subscribe(listener: (state: AuthState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Awaits the serialized queue; test and shutdown helper. */
  async settle(): Promise<void> {
    await this.queue;
  }

  private enqueue<T>(op: () => Promise<T>): Promise<T> {
    const result = this.queue.then(op);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private dispatch(event: AuthEvent): void {
    const previous = this.state;
    const next = this.reduce(previous, event);
    if (next !== previous) {
      this.state = next;
      this.deps.diagnostics.record('auth_transition', {
        fromState: previous.name,
        toState: next.name,
        event: event.type,
      });
      for (const listener of this.listeners) {
        listener(next);
      }
    }
  }

  private tryAcquire(): ClientBundle | null {
    try {
      return this.lifecycle.acquire();
    } catch {
      return null;
    }
  }

  private createClient(): ClientBundle {
    const bundle = this.lifecycle.create();
    this.heldBundle = bundle;
    this.attachListener(bundle);
    return bundle;
  }

  private attachListener(bundle: ClientBundle): void {
    const subscribedEpoch = this.epoch.current();
    this.unsubscribeAuth = bundle.auth.onAuthStateChange((event) => {
      if (!this.epoch.isCurrent(subscribedEpoch)) {
        this.deps.diagnostics.record('auth_epoch_stale_event', { event });
        return;
      }
      if (event === 'SIGNED_OUT') {
        void this.enqueue(() => this.runSignOutSequence('expired'));
      }
    });
  }

  private handleStorageOrFatal(error: unknown): void {
    if (error instanceof QuarantineRequiredError) {
      this.deps.diagnostics.record('storage_quarantine_entered', { code: error.code });
      this.dispatch({ type: 'STORAGE_FAILURE', code: 'storage' });
      return;
    }
    this.dispatch({ type: 'FATAL', code: toSafeError(error).code });
  }

  boot(): Promise<void> {
    return this.enqueue(async () => {
      if (this.state.name !== 'booting') return;
      try {
        const residue = await this.deps.storage.hasResidue();
        const markerExists = await this.deps.marker.exists();
        if (residue && !markerExists) {
          // Reinstall over a stale iOS Keychain: purge and verify before any
          // auth construction.
          this.deps.diagnostics.record('reinstall_purge', {});
          try {
            await this.deps.storage.scrubAll();
          } catch (error) {
            this.handleStorageOrFatal(error);
            return;
          }
        }
        try {
          await this.deps.marker.ensure();
        } catch {
          // A missing marker fails closed on the next boot (re-scrub); boot
          // continues.
        }
        const bundle = this.createClient();
        let session: SessionInfo | null;
        try {
          session = await bundle.auth.getSession();
        } catch (error) {
          this.handleStorageOrFatal(error);
          return;
        }
        if (!session) {
          this.dispatch({ type: 'BOOTED_NO_SESSION' });
          return;
        }
        if (session.expiresAt !== null && session.expiresAt <= this.deps.clock.now()) {
          const cleaned = await this.cleanupLocalSession('expiry');
          if (cleaned) this.dispatch({ type: 'BOOTED_EXPIRED' });
          return;
        }
        await this.loadAndRoute(session, 'boot');
      } catch (error) {
        this.dispatch({ type: 'FATAL', code: toSafeError(error).code });
      }
    });
  }

  /** Local + remote cleanup without the full state sequence, for paths that
   * are not in a session-holding state (boot expiry, zero memberships).
   * Returns false when storage deletion failed (state is then quarantined). */
  private async cleanupLocalSession(reason: ClearReason): Promise<boolean> {
    const bundle = this.heldBundle;
    bundle?.auth.stopAutoRefresh();
    this.pendingEmail = null;
    this.deps.registry.clearAll(reason);
    try {
      await bundle?.auth.signOutRemote();
    } catch {
      // Revocation failure must never preserve local access; continue.
    }
    try {
      await this.deps.storage.delete();
    } catch (error) {
      this.handleStorageOrFatal(error);
      return false;
    }
    return true;
  }

  private async loadAndRoute(session: SessionInfo, origin: RouteOrigin): Promise<void> {
    const bundle = this.heldBundle;
    if (!bundle) return;
    let memberships: Membership[];
    try {
      memberships = await bundle.memberships.listMemberships(session.userId);
    } catch (error) {
      const code = toSafeError(error).code;
      if (origin === 'boot') {
        // Offline launch: never cached protected content, safe recovery only.
        this.dispatch({ type: 'BOOTED_OFFLINE' });
      } else if (origin === 'first_factor') {
        this.dispatch({ type: 'FIRST_FACTOR_FAILED', code });
      } else {
        this.dispatch({ type: 'MFA_FAILED', code });
      }
      return;
    }
    if (memberships.length === 0) {
      const cleaned = await this.cleanupLocalSession('sign_out');
      if (cleaned) this.dispatch({ type: 'NO_ACCESS' });
      return;
    }
    if (membershipsRequireAal2(memberships) && session.aal !== 'aal2') {
      this.dispatch({ type: 'MFA_CHALLENGE_REQUIRED' });
      return;
    }
    this.dispatch({
      type: 'SCOPES_LOADED',
      actor: { userId: session.userId, aal: session.aal },
      memberships,
    });
  }

  startSignIn(email: string): Promise<void> {
    return this.enqueue(async () => {
      if (this.state.name !== 'signed_out') return;
      this.pendingEmail = email;
      this.dispatch({ type: 'SIGN_IN_STARTED', email });
      await this.requestOtpInternal();
    });
  }

  /** Re-send the OTP for the pending email. */
  requestOtp(): Promise<void> {
    return this.enqueue(() => this.requestOtpInternal());
  }

  private async requestOtpInternal(): Promise<void> {
    if (this.state.name !== 'first_factor' || !this.pendingEmail) return;
    const bundle = this.tryAcquire();
    if (!bundle) return;
    try {
      // Invite-only: the gateway sends with shouldCreateUser: false.
      await bundle.auth.requestOtp(this.pendingEmail);
      this.dispatch({ type: 'OTP_REQUESTED' });
    } catch (error) {
      this.dispatch({ type: 'OTP_REQUEST_FAILED', code: toSafeError(error).code });
    }
  }

  submitOtp(code: string): Promise<void> {
    return this.enqueue(async () => {
      if (this.state.name !== 'first_factor' || !this.state.otpSent || !this.pendingEmail) return;
      this.dispatch({ type: 'OTP_SUBMITTED' });
      const bundle = this.tryAcquire();
      if (!bundle) return;
      let session: SessionInfo;
      try {
        session = await bundle.auth.verifyOtp(this.pendingEmail, code);
      } catch (error) {
        if (error instanceof QuarantineRequiredError) {
          this.handleStorageOrFatal(error);
          return;
        }
        const safe = toSafeError(error);
        this.dispatch({
          type: 'FIRST_FACTOR_FAILED',
          code: safe.code === 'unknown' ? 'auth_invalid' : safe.code,
        });
        return;
      }
      await this.loadAndRoute(session, 'first_factor');
    });
  }

  submitTotp(code: string): Promise<void> {
    return this.enqueue(async () => {
      if (this.state.name !== 'mfa_required') return;
      this.dispatch({ type: 'MFA_SUBMITTED' });
      const bundle = this.tryAcquire();
      if (!bundle) return;
      let session: SessionInfo;
      try {
        const factorId = await bundle.auth.listTotpFactorId();
        if (!factorId) {
          this.dispatch({ type: 'MFA_FAILED', code: 'denied' });
          return;
        }
        session = await bundle.auth.verifyTotp(factorId, code);
      } catch (error) {
        if (error instanceof QuarantineRequiredError) {
          this.handleStorageOrFatal(error);
          return;
        }
        const safe = toSafeError(error);
        this.dispatch({
          type: 'MFA_FAILED',
          code: safe.code === 'unknown' ? 'auth_invalid' : safe.code,
        });
        return;
      }
      await this.loadAndRoute(session, 'mfa');
    });
  }

  cancelSignIn(): Promise<void> {
    return this.enqueue(async () => {
      if (this.state.name !== 'first_factor') return;
      this.pendingEmail = null;
      this.dispatch({ type: 'RETURN_TO_SIGNED_OUT' });
    });
  }

  selectScope(membershipId: MembershipId): Promise<void> {
    return this.enqueue(async () => {
      if (this.state.name !== 'select_scope') return;
      this.dispatch({ type: 'SCOPE_SELECTED', membershipId });
    });
  }

  switchScope(): Promise<void> {
    return this.enqueue(async () => {
      if (this.state.name !== 'authorized') return;
      // Clear every actor-bound repository before the chooser renders.
      this.deps.registry.clearAll('scope_switch');
      this.deps.diagnostics.record('scope_cleared', { reason: 'scope_switch' });
      this.dispatch({ type: 'SCOPE_SWITCH_REQUESTED' });
    });
  }

  signOut(): Promise<void> {
    return this.enqueue(() => this.runSignOutSequence('user'));
  }

  switchIdentity(): Promise<void> {
    return this.enqueue(() => this.runSignOutSequence('identity_switch'));
  }

  /** Repositories call this on a 401/expired signal. */
  sessionExpired(): Promise<void> {
    return this.enqueue(() => this.runSignOutSequence('expired'));
  }

  /** The exclusive, actor-bound sign-out/reset sequence. Runs only on the
   * serialized queue. See docs/auth-state-machine.md. */
  private async runSignOutSequence(reason: SignOutReason): Promise<void> {
    if (!SESSION_HOLDING_STATES.includes(this.state.name)) return;
    this.dispatch({ type: 'SIGN_OUT_REQUESTED', reason });
    // 1. Freeze acquisition: no new work can obtain the client.
    this.lifecycle.freeze();
    // 2. Advance the epoch: late callbacks are ignored from here on.
    this.epoch.next();
    const bundle = this.heldBundle;
    // 3. Stop refresh and listeners.
    bundle?.auth.stopAutoRefresh();
    this.unsubscribeAuth?.();
    this.unsubscribeAuth = null;
    // 4. Clear actor/scope state.
    this.pendingEmail = null;
    const clearReason: ClearReason =
      reason === 'identity_switch' ? 'identity_switch' : reason === 'expired' ? 'expiry' : 'sign_out';
    this.deps.registry.clearAll(clearReason);
    // 5. Remote revocation; failure cannot preserve local access.
    try {
      await bundle?.auth.signOutRemote();
    } catch {
      this.deps.diagnostics.record('auth_transition', {
        event: 'REMOTE_REVOCATION_FAILED',
        outcome: 'continuing_local_signout',
      });
    }
    // 6. Delete session storage with read-back verification (inside delete()).
    try {
      await this.deps.storage.delete();
    } catch (error) {
      const code = error instanceof QuarantineRequiredError ? error.code : 'unknown';
      this.deps.diagnostics.record('storage_quarantine_entered', { code });
      // The client is left frozen: never nulled or recreated, no session
      // evaluation, no protected UI, no generic retry.
      this.dispatch({ type: 'SIGN_OUT_STORAGE_FAILED' });
      return;
    }
    // 7. Only now dispose the client and complete.
    this.lifecycle.dispose();
    this.heldBundle = null;
    this.dispatch({ type: 'SIGN_OUT_SUCCEEDED' });
    // Fresh client for the next sign-in, under the new epoch.
    this.createClient();
  }

  scrubQuarantine(): Promise<void> {
    return this.enqueue(async () => {
      if (this.state.name !== 'storage_quarantined' || this.state.scrubInProgress) return;
      this.dispatch({ type: 'QUARANTINE_SCRUB_STARTED' });
      try {
        await this.deps.storage.scrubAll();
      } catch {
        this.deps.diagnostics.record('storage_scrub_result', { outcome: 'failed' });
        this.dispatch({ type: 'QUARANTINE_SCRUB_FAILED' });
        return;
      }
      this.deps.diagnostics.record('storage_scrub_result', { outcome: 'ok' });
      this.epoch.next();
      this.unsubscribeAuth?.();
      this.unsubscribeAuth = null;
      this.lifecycle.dispose();
      this.heldBundle = null;
      this.createClient();
      this.dispatch({ type: 'QUARANTINE_SCRUB_SUCCEEDED' });
    });
  }

  /** React Native AppState wiring: refresh runs only in the foreground and
   * only while a session-bearing, post-auth state holds. */
  handleAppStateChange(status: AppStatus): void {
    void this.enqueue(async () => {
      if (status === 'active') {
        if (this.state.name === 'authorized' || this.state.name === 'select_scope') {
          this.tryAcquire()?.auth.startAutoRefresh();
        }
        return;
      }
      if (status === 'background' || status === 'inactive') {
        this.tryAcquire()?.auth.stopAutoRefresh();
      }
    });
  }
}
