import { fixedClock } from '@/core/clock';
import { createDiagnostics, type DiagnosticEventName } from '@/core/diagnostics';
import type { UserId } from '@/core/ids';
import { ScopedRegistry, type ClearReason } from '@/tenancy/clearing';
import type { Membership } from '@/tenancy/types';

import {
  type AuthGateway,
  type AuthListenerEvent,
  type BundleEvents,
  type ClientBundle,
  type SessionInfo,
  SessionExpiredError,
  SessionOfflineError,
} from '../client-lifecycle';
import { AuthController, type SessionStorage } from '../controller';
import { InstallMarker } from '../install-marker';
import { QuarantineRequiredError } from '../secure-store-adapter';
import { USER_CLIENT, USER_STAFF, membershipA1, membershipA2, membershipB1Staff } from './fixtures';

class FakeSessionStorage implements SessionStorage {
  residue = false;
  deleted = 0;
  scrubbed = 0;
  failDelete = false;
  failScrub = false;
  deleteDelayMs = 0;
  log: string[];

  constructor(log: string[] = []) {
    this.log = log;
  }

  async read(): Promise<string | null> {
    return null;
  }
  async write(): Promise<void> {}
  async delete(): Promise<void> {
    if (this.deleteDelayMs > 0) await new Promise((r) => setTimeout(r, this.deleteDelayMs));
    this.log.push('storage.delete');
    if (this.failDelete) throw new QuarantineRequiredError('delete_failed');
    this.deleted += 1;
    this.residue = false;
  }
  async scrubAll(): Promise<void> {
    this.log.push('storage.scrubAll');
    if (this.failScrub) throw new QuarantineRequiredError('delete_failed');
    this.scrubbed += 1;
    this.residue = false;
  }
  async hasResidue(): Promise<boolean> {
    return this.residue;
  }
}

class FakeMarkerStore {
  content: string | null = null;
  /** Set to simulate a marker that cannot be persisted — the device
   * condition behind find 14, where the write threw and nothing said so. */
  writeError: Error | null = null;
  async read(): Promise<string | null> {
    return this.content;
  }
  async write(content: string): Promise<void> {
    if (this.writeError) throw this.writeError;
    this.content = content;
  }
}

class FakeAuthGateway implements AuthGateway {
  session: SessionInfo | null = null;
  verifyResult: SessionInfo | null = null;
  totpResult: SessionInfo | null = null;
  totpFactorId: string | null = 'factor-synthetic';
  unverifiedFactorIds: string[] = [];
  enrollError: Error | null = null;
  unenrollError: Error | null = null;
  enrolled = 0;
  unenrolled: string[] = [];
  requestOtpError: Error | null = null;
  verifyOtpError: Error | null = null;
  signOutRemoteError: Error | null = null;
  listeners: ((event: AuthListenerEvent) => void)[] = [];
  log: string[];

  constructor(log: string[] = []) {
    this.log = log;
  }

  sessionError: Error | null = null;
  /** The real library removes the stored session and notifies SIGNED_OUT
   * BEFORE getSession() returns the rejected-refresh error (auth-js
   * _callRefreshToken -> _removeSession); model that ordering on demand. */
  sessionErrorEmitsSignedOut = false;
  async getSession(): Promise<SessionInfo | null> {
    this.log.push('auth.getSession');
    if (this.sessionError) {
      if (this.sessionErrorEmitsSignedOut) this.emit('SIGNED_OUT');
      throw this.sessionError;
    }
    return this.session;
  }
  async requestOtp(email: string): Promise<void> {
    this.log.push(`auth.requestOtp:${email}`);
    if (this.requestOtpError) throw this.requestOtpError;
  }
  async verifyOtp(): Promise<SessionInfo> {
    this.log.push('auth.verifyOtp');
    if (this.verifyOtpError) throw this.verifyOtpError;
    if (!this.verifyResult) throw new Error('no verify result configured');
    return this.verifyResult;
  }
  async listTotpFactors(): Promise<{ verifiedId: string | null; unverifiedIds: string[] }> {
    return { verifiedId: this.totpFactorId, unverifiedIds: this.unverifiedFactorIds };
  }
  async enrollTotp(): Promise<{
    factorId: string;
    secret: string;
    qrSvg: string | null;
    uri: string | null;
  }> {
    this.log.push('auth.enrollTotp');
    if (this.enrollError) throw this.enrollError;
    this.enrolled += 1;
    return {
      factorId: 'factor-enrolled-synthetic',
      secret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
      qrSvg: '<svg>synthetic</svg>',
      uri: 'otpauth://totp/synthetic',
    };
  }
  async unenrollTotp(factorId: string): Promise<void> {
    this.log.push('auth.unenrollTotp');
    if (this.unenrollError) throw this.unenrollError;
    this.unenrolled.push(factorId);
    this.unverifiedFactorIds = this.unverifiedFactorIds.filter((id) => id !== factorId);
  }
  async verifyTotp(): Promise<SessionInfo> {
    this.log.push('auth.verifyTotp');
    if (!this.totpResult) throw new Error('totp rejected (synthetic)');
    return this.totpResult;
  }
  async signOutRemote(): Promise<void> {
    this.log.push('auth.signOutRemote');
    if (this.signOutRemoteError) throw this.signOutRemoteError;
    this.session = null;
  }
  startAutoRefresh(): void {
    this.log.push('auth.startAutoRefresh');
  }
  stopAutoRefresh(): void {
    this.log.push('auth.stopAutoRefresh');
  }
  onAuthStateChange(listener: (event: AuthListenerEvent) => void): () => void {
    this.log.push('auth.subscribe');
    this.listeners.push(listener);
    // Deliberately retain the listener after unsubscribe so tests can
    // simulate late event delivery; the epoch gate must ignore it.
    return () => this.log.push('auth.unsubscribe');
  }
  emit(event: AuthListenerEvent): void {
    for (const l of this.listeners) l(event);
  }
}

interface Harness {
  controller: AuthController;
  gateway: FakeAuthGateway;
  storage: FakeSessionStorage;
  markerStore: FakeMarkerStore;
  registry: ScopedRegistry;
  clearLog: ClearReason[];
  diagnosticsLog: { name: DiagnosticEventName; fields: Record<string, unknown> }[];
  log: string[];
  factoryCalls: () => number;
  /** The events the controller handed each bundle at creation, oldest
   * first; a test raises a library-met storage quarantine through the
   * bundle's own channel, as the storage bridge does (find 46). */
  bundleEvents: BundleEvents[];
  /** Server-side membership changes after sign-in (find 38). */
  setMemberships: (list: Membership[]) => void;
  setMembershipError: (error: Error | null) => void;
}

function makeHarness(options?: {
  memberships?: Membership[];
  membershipError?: Error;
  now?: number;
  initialAppStatus?: 'active' | 'background' | 'inactive' | 'unknown';
}): Harness {
  const log: string[] = [];
  const gateway = new FakeAuthGateway(log);
  const storage = new FakeSessionStorage(log);
  const markerStore = new FakeMarkerStore();
  const registry = new ScopedRegistry();
  const clearLog: ClearReason[] = [];
  registry.register({ clear: (reason) => clearLog.push(reason) });
  const diagnosticsLog: Harness['diagnosticsLog'] = [];
  let factoryCalls = 0;
  const membershipsByUser = new Map<UserId, Membership[]>();
  membershipsByUser.set(USER_CLIENT, options?.memberships ?? [membershipA1]);
  membershipsByUser.set(USER_STAFF, [membershipB1Staff]);
  let membershipError: Error | null = options?.membershipError ?? null;
  const bundleEvents: BundleEvents[] = [];
  const controller = new AuthController({
    createBundle: (events): ClientBundle => {
      factoryCalls += 1;
      bundleEvents.push(events);
      log.push('factory.create');
      return {
        auth: gateway,
        memberships: {
          listMemberships: async (userId) => {
            log.push('memberships.list');
            if (membershipError) throw membershipError;
            return membershipsByUser.get(userId) ?? [];
          },
        },
        dispose: () => log.push('bundle.dispose'),
      };
    },
    storage,
    marker: new InstallMarker(markerStore, { fill: (b) => b.fill(7) }, () => 1_000),
    registry,
    diagnostics: createDiagnostics({
      write: (name, fields) => diagnosticsLog.push({ name, fields }),
    }),
    clock: fixedClock(options?.now ?? 1_000_000),
    failMode: 'closed',
    initialAppStatus: options?.initialAppStatus ?? 'unknown',
  });
  return {
    controller,
    gateway,
    storage,
    markerStore,
    registry,
    clearLog,
    diagnosticsLog,
    log,
    factoryCalls: () => factoryCalls,
    bundleEvents,
    setMemberships: (list) => {
      membershipsByUser.set(USER_CLIENT, list);
    },
    setMembershipError: (error) => {
      membershipError = error;
    },
  };
}

const clientSession: SessionInfo = { userId: USER_CLIENT, aal: 'aal1', expiresAt: 2_000_000 };
const staffSessionAal1: SessionInfo = { userId: USER_STAFF, aal: 'aal1', expiresAt: 2_000_000 };
const staffSessionAal2: SessionInfo = { userId: USER_STAFF, aal: 'aal2', expiresAt: 2_000_000 };

describe('boot', () => {
  it('lands signed_out(initial) with no session', async () => {
    const h = makeHarness();
    await h.controller.boot();
    expect(h.controller.getState()).toMatchObject({ name: 'signed_out', reason: 'initial' });
  });

  it('authorizes directly with one membership', async () => {
    const h = makeHarness();
    h.gateway.session = clientSession;
    await h.controller.boot();
    expect(h.controller.getState().name).toBe('authorized');
  });

  it('forces scope selection with two memberships', async () => {
    const h = makeHarness({ memberships: [membershipA1, membershipA2] });
    h.gateway.session = clientSession;
    await h.controller.boot();
    expect(h.controller.getState().name).toBe('select_scope');
  });

  it('requires MFA when staff memberships exist at aal1', async () => {
    const h = makeHarness();
    h.gateway.session = staffSessionAal1;
    await h.controller.boot();
    expect(h.controller.getState().name).toBe('mfa_required');
  });

  it('signs out an expired session and reports expiry', async () => {
    const h = makeHarness({ now: 3_000_000 });
    h.gateway.session = clientSession; // expiresAt 2,000,000 < now
    await h.controller.boot();
    expect(h.controller.getState()).toMatchObject({ name: 'signed_out', reason: 'expired' });
    expect(h.storage.deleted).toBe(1);
  });

  // 2026-09-06 review: through the real gateway a stored session is never
  // returned already-expired — it is refreshed, or the refresh is rejected.
  // A REJECTED refresh is a dead session and must take the expiry branch,
  // not the fatal screen; an unreachable server is an offline launch.
  it('treats a dead stored session (refresh rejected) as expiry, never fatal', async () => {
    const h = makeHarness();
    h.gateway.sessionError = new SessionExpiredError();
    await h.controller.boot();
    expect(h.controller.getState()).toMatchObject({ name: 'signed_out', reason: 'expired' });
    expect(h.storage.deleted).toBe(1);
    expect(h.log).toContain('auth.signOutRemote');
  });

  it('treats an unreachable auth server at boot as an offline launch, keeping the session', async () => {
    const h = makeHarness();
    h.gateway.sessionError = new SessionOfflineError();
    await h.controller.boot();
    expect(h.controller.getState()).toMatchObject({ name: 'signed_out', reason: 'offline' });
    expect(h.storage.deleted).toBe(0);
  });

  it('absorbs the SIGNED_OUT the library emits while rejecting the boot refresh: one cleanup, not two', async () => {
    const h = makeHarness();
    h.gateway.sessionError = new SessionExpiredError();
    h.gateway.sessionErrorEmitsSignedOut = true;
    await h.controller.boot();
    await h.controller.settle();
    expect(h.controller.getState()).toMatchObject({ name: 'signed_out', reason: 'expired' });
    // The listener's queued sign-out sequence finds signed_out and returns:
    // exactly one deletion and one remote revocation, no second sequence.
    expect(h.storage.deleted).toBe(1);
    expect(h.log.filter((e) => e === 'auth.signOutRemote')).toHaveLength(1);
    expect(h.diagnosticsLog.some((d) => d.name === 'auth_epoch_stale_event')).toBe(false);
  });

  it('cleans up locally and reports no_access for zero memberships', async () => {
    const h = makeHarness({ memberships: [] });
    h.gateway.session = clientSession;
    await h.controller.boot();
    expect(h.controller.getState()).toMatchObject({ name: 'signed_out', reason: 'no_access' });
    expect(h.log).toContain('auth.signOutRemote');
    expect(h.storage.deleted).toBe(1);
  });

  it('shows offline recovery, never cached protected content, when memberships cannot load', async () => {
    const h = makeHarness({ membershipError: new TypeError('Network request failed') });
    h.gateway.session = clientSession;
    await h.controller.boot();
    expect(h.controller.getState()).toMatchObject({ name: 'signed_out', reason: 'offline' });
  });
});

describe('reinstall reconciliation', () => {
  it('scrubs stale keychain material before constructing the client', async () => {
    const h = makeHarness();
    h.storage.residue = true; // secure material exists
    // marker absent → reinstall
    await h.controller.boot();
    expect(h.storage.scrubbed).toBe(1);
    expect(h.log.indexOf('storage.scrubAll')).toBeLessThan(h.log.indexOf('factory.create'));
    expect(h.controller.getState().name).toBe('signed_out');
    expect(h.markerStore.content).not.toBeNull();
  });

  // Find 14: on device the marker write threw, boot swallowed it in an empty
  // catch, and every later boot therefore took the reinstall branch and
  // destroyed the session. Boot must still continue — a marker is not a
  // session — but it must never fail silently again.
  it('records a diagnostic when the marker cannot be written', async () => {
    const h = makeHarness();
    h.markerStore.writeError = new Error('Secure random source unavailable');
    h.gateway.session = clientSession;
    await h.controller.boot();
    expect(h.markerStore.content).toBeNull();
    expect(h.diagnosticsLog.map((e) => e.name)).toContain('install_marker_failed');
    // Boot is not aborted by it: the session still loads.
    expect(h.controller.getState().name).toBe('authorized');
  });

  it('does not scrub when the marker matches', async () => {
    const h = makeHarness();
    h.storage.residue = true;
    await h.markerStore.write('{"v":1,"installId":"07070707","createdAt":1}');
    h.gateway.session = clientSession;
    await h.controller.boot();
    expect(h.storage.scrubbed).toBe(0);
    expect(h.controller.getState().name).toBe('authorized');
  });

  it('enters quarantine when the reinstall purge fails', async () => {
    const h = makeHarness();
    h.storage.residue = true;
    h.storage.failScrub = true;
    await h.controller.boot();
    expect(h.controller.getState().name).toBe('storage_quarantined');
    // The client must never have been constructed over unverified storage.
    expect(h.factoryCalls()).toBe(0);
  });
});

describe('sign-in flow', () => {
  async function signedOutHarness() {
    const h = makeHarness();
    await h.controller.boot();
    return h;
  }

  it('requests an OTP and walks to authorized', async () => {
    const h = await signedOutHarness();
    await h.controller.startSignIn('client.owner@example.invalid');
    expect(h.log).toContain('auth.requestOtp:client.owner@example.invalid');
    expect(h.controller.getState()).toMatchObject({ name: 'first_factor', otpSent: true });
    h.gateway.verifyResult = clientSession;
    await h.controller.submitOtp('123456');
    expect(h.controller.getState().name).toBe('authorized');
  });

  it('keeps a safe notice when the OTP request fails', async () => {
    const h = await signedOutHarness();
    h.gateway.requestOtpError = new TypeError('Network request failed');
    await h.controller.startSignIn('client.owner@example.invalid');
    expect(h.controller.getState()).toMatchObject({
      name: 'first_factor',
      otpSent: false,
      notice: 'network',
    });
  });

  it('reports an invalid code and allows retry', async () => {
    const h = await signedOutHarness();
    await h.controller.startSignIn('client.owner@example.invalid');
    h.gateway.verifyOtpError = new Error('otp_expired (synthetic)');
    await h.controller.submitOtp('000000');
    expect(h.controller.getState()).toMatchObject({
      name: 'first_factor',
      otpSent: true,
      verifying: false,
      notice: 'auth_invalid',
    });
  });

  it('routes staff through TOTP MFA to authorized', async () => {
    const h = await signedOutHarness();
    await h.controller.startSignIn('staff.preparer@example.invalid');
    h.gateway.verifyResult = staffSessionAal1;
    await h.controller.submitOtp('123456');
    expect(h.controller.getState().name).toBe('mfa_required');
    h.gateway.totpResult = staffSessionAal2;
    await h.controller.submitTotp('654321');
    expect(h.controller.getState().name).toBe('authorized');
  });

  it('fails MFA closed on a bad code', async () => {
    const h = await signedOutHarness();
    await h.controller.startSignIn('staff.preparer@example.invalid');
    h.gateway.verifyResult = staffSessionAal1;
    await h.controller.submitOtp('123456');
    h.gateway.totpResult = null;
    await h.controller.submitTotp('000000');
    expect(h.controller.getState()).toMatchObject({ name: 'mfa_required', notice: 'auth_invalid' });
  });
});

describe('sign-out sequence', () => {
  async function authorizedHarness(memberships?: Membership[]) {
    const h = makeHarness(memberships ? { memberships } : undefined);
    h.gateway.session = clientSession;
    await h.controller.boot();
    expect(h.controller.getState().name).toBe(memberships ? 'select_scope' : 'authorized');
    return h;
  }

  it('runs the exclusive sequence in the documented order', async () => {
    const h = await authorizedHarness();
    h.log.length = 0;
    await h.controller.signOut();
    expect(h.controller.getState()).toMatchObject({ name: 'signed_out', reason: 'signed_out' });
    const order = h.log.filter((e) =>
      [
        'auth.stopAutoRefresh',
        'auth.unsubscribe',
        'auth.signOutRemote',
        'storage.delete',
        'bundle.dispose',
      ].includes(e),
    );
    expect(order).toEqual([
      'auth.stopAutoRefresh',
      'auth.unsubscribe',
      'auth.signOutRemote',
      'storage.delete',
      'bundle.dispose',
    ]);
    expect(h.clearLog).toContain('sign_out');
  });

  it('network revocation failure cannot preserve local access', async () => {
    const h = await authorizedHarness();
    h.gateway.signOutRemoteError = new TypeError('Network request failed');
    await h.controller.signOut();
    expect(h.controller.getState().name).toBe('signed_out');
    expect(h.storage.deleted).toBe(1);
  });

  it('REGRESSION: storage deletion failure after sign-out begins quarantines and never recreates the client', async () => {
    const h = await authorizedHarness();
    const factoryCallsBefore = h.factoryCalls();
    const getSessionCallsBefore = h.log.filter((e) => e === 'auth.getSession').length;
    h.storage.failDelete = true;
    await h.controller.signOut();
    expect(h.controller.getState().name).toBe('storage_quarantined');
    // No code path may null/recreate the Supabase client...
    expect(h.factoryCalls()).toBe(factoryCallsBefore);
    // ...evaluate the retained session...
    expect(h.log.filter((e) => e === 'auth.getSession').length).toBe(getSessionCallsBefore);
    // ...or let a generic retry authorize.
    await h.controller.boot();
    await h.controller.startSignIn('client.owner@example.invalid');
    expect(h.controller.getState().name).toBe('storage_quarantined');
    expect(h.factoryCalls()).toBe(factoryCallsBefore);
    // Only successful scrub verification may exit quarantine.
    h.storage.failDelete = false;
    await h.controller.scrubQuarantine();
    expect(h.controller.getState()).toMatchObject({ name: 'signed_out', reason: 'scrubbed' });
    expect(h.factoryCalls()).toBe(factoryCallsBefore + 1);
  });

  it('a failed scrub stays quarantined', async () => {
    const h = await authorizedHarness();
    h.storage.failDelete = true;
    await h.controller.signOut();
    h.storage.failScrub = true;
    await h.controller.scrubQuarantine();
    expect(h.controller.getState()).toMatchObject({
      name: 'storage_quarantined',
      lastAttemptFailed: true,
    });
  });

  it('identity switch clears scope and all actor-bound state', async () => {
    const h = await authorizedHarness();
    await h.controller.switchIdentity();
    expect(h.controller.getState().name).toBe('signed_out');
    expect(h.clearLog).toContain('identity_switch');
    const state = h.controller.getState();
    expect(state).not.toHaveProperty('actor');
    expect(state).not.toHaveProperty('memberships');
  });

  it('scope switch clears repositories before offering the chooser', async () => {
    const h = await authorizedHarness([membershipA1, membershipA2]);
    await h.controller.selectScope(membershipA2.membershipId);
    expect(h.controller.getState().name).toBe('authorized');
    await h.controller.switchScope();
    expect(h.controller.getState().name).toBe('select_scope');
    expect(h.clearLog).toContain('scope_switch');
  });
});

describe('epoch and serialization', () => {
  it('ignores late auth listener events from a previous epoch', async () => {
    const h = makeHarness();
    h.gateway.session = clientSession;
    await h.controller.boot();
    await h.controller.signOut();
    const before = h.controller.getState();
    // The fake gateway retains listeners after unsubscribe; emitting now
    // simulates a late delivery from the old client.
    h.gateway.emit('SIGNED_OUT');
    await h.controller.settle();
    expect(h.controller.getState()).toBe(before);
    expect(h.diagnosticsLog.some((d) => d.name === 'auth_epoch_stale_event')).toBe(true);
  });

  it('serializes a refresh request that arrives during sign-out', async () => {
    const h = makeHarness();
    h.gateway.session = clientSession;
    await h.controller.boot();
    h.storage.deleteDelayMs = 20;
    const signOutPromise = h.controller.signOut();
    h.controller.handleAppStateChange('active'); // suspension/resume mid-sign-out
    await signOutPromise;
    await h.controller.settle();
    const deleteIndex = h.log.indexOf('storage.delete');
    const startsAfterSignOut = h.log
      .slice(deleteIndex)
      .filter((e) => e === 'auth.startAutoRefresh');
    // The queued foreground handler ran after sign-out and found no session
    // state, so refresh never started.
    expect(startsAfterSignOut).toHaveLength(0);
    expect(h.controller.getState().name).toBe('signed_out');
  });

  it('absorbs an expiry event that lands during sign-out', async () => {
    const h = makeHarness();
    h.gateway.session = clientSession;
    await h.controller.boot();
    h.storage.deleteDelayMs = 20;
    const signOutPromise = h.controller.signOut();
    h.gateway.emit('SIGNED_OUT'); // server-side expiry racing local sign-out
    await signOutPromise;
    await h.controller.settle();
    expect(h.controller.getState().name).toBe('signed_out');
    expect(h.storage.deleted).toBe(1); // exactly one deletion; no double run
  });

  it('starts refresh only in the foreground with a bound session, stops in background', async () => {
    const h = makeHarness();
    h.gateway.session = clientSession;
    await h.controller.boot();
    h.controller.handleAppStateChange('active');
    await h.controller.settle();
    expect(h.log).toContain('auth.startAutoRefresh');
    h.controller.handleAppStateChange('background');
    await h.controller.settle();
    const lastStart = h.log.lastIndexOf('auth.startAutoRefresh');
    const lastStop = h.log.lastIndexOf('auth.stopAutoRefresh');
    expect(lastStop).toBeGreaterThan(lastStart);
  });

  it('does not start refresh in the foreground when signed out', async () => {
    const h = makeHarness();
    await h.controller.boot();
    h.log.length = 0;
    h.controller.handleAppStateChange('active');
    await h.controller.settle();
    expect(h.log).not.toContain('auth.startAutoRefresh');
  });
});

describe('storage failure surfaces', () => {
  it('quarantines when the gateway surfaces a storage quarantine error at boot', async () => {
    const h = makeHarness();
    h.gateway.getSession = async () => {
      throw new QuarantineRequiredError('corrupt');
    };
    await h.controller.boot();
    expect(h.controller.getState().name).toBe('storage_quarantined');
  });
});

describe('storage failures via the data path (review P2-5)', () => {
  it('quarantines when membership loading surfaces a storage quarantine error', async () => {
    const h = makeHarness({ membershipError: new QuarantineRequiredError('corrupt') });
    h.gateway.session = clientSession;
    await h.controller.boot();
    expect(h.controller.getState().name).toBe('storage_quarantined');
  });
});

/** Find 46 (2026-09-07 desktop run): the auth library's own readers (the
 * refresh tick, the initial-session emitter, a data call's token lookup)
 * can meet the storage failure before any controller call does. The
 * storage bridge absorbs it and reports it through the bundle's events;
 * the controller then takes the same transition it takes for its own
 * reads — from any state, clearing actor-bound state, once. */
describe('quarantine met by a library-internal reader (find 46)', () => {
  function latestBundleEvents(h: Harness): BundleEvents {
    const events = h.bundleEvents[h.bundleEvents.length - 1];
    if (!events) throw new Error('no bundle created yet');
    return events;
  }

  it('enters quarantine from authorized: refresh stopped, scoped data cleared as quarantine, one diagnostic', async () => {
    const h = makeHarness({ initialAppStatus: 'active' });
    h.gateway.session = clientSession;
    await h.controller.boot();
    expect(h.controller.getState().name).toBe('authorized');
    expect(h.log).toContain('auth.startAutoRefresh');
    h.log.length = 0;

    latestBundleEvents(h).onStorageQuarantine(new QuarantineRequiredError('corrupt'));
    await h.controller.settle();

    expect(h.controller.getState()).toMatchObject({
      name: 'storage_quarantined',
      scrubInProgress: false,
      lastAttemptFailed: false,
    });
    expect(h.log).toContain('auth.stopAutoRefresh');
    expect(h.clearLog).toEqual(['quarantine']);
    expect(h.diagnosticsLog.filter((d) => d.name === 'storage_quarantine_entered')).toEqual([
      { name: 'storage_quarantine_entered', fields: { code: 'corrupt' } },
    ]);
  });

  it('enters quarantine from a pending sign-in too, discarding the pending email', async () => {
    const h = makeHarness();
    await h.controller.boot();
    await h.controller.startSignIn('client@example.invalid');
    await h.controller.requestOtp();
    expect(h.controller.getState()).toMatchObject({ name: 'first_factor', otpSent: true });

    latestBundleEvents(h).onStorageQuarantine(new QuarantineRequiredError('write_unverified'));
    await h.controller.settle();

    expect(h.controller.getState().name).toBe('storage_quarantined');
    // A later OTP submission has nothing to act on: quarantine absorbs it.
    await h.controller.submitOtp('123456');
    expect(h.controller.getState().name).toBe('storage_quarantined');
    expect(h.log).not.toContain('auth.verifyOtp');
  });

  it('a second report while quarantined changes nothing and records nothing more', async () => {
    const h = makeHarness();
    h.gateway.session = clientSession;
    await h.controller.boot();
    latestBundleEvents(h).onStorageQuarantine(new QuarantineRequiredError('corrupt'));
    await h.controller.settle();
    const transitions = h.diagnosticsLog.length;

    latestBundleEvents(h).onStorageQuarantine(new QuarantineRequiredError('partial'));
    await h.controller.settle();

    expect(h.controller.getState().name).toBe('storage_quarantined');
    expect(h.diagnosticsLog).toHaveLength(transitions);
  });

  it('ignores a report from the bundle a completed sign-out disposed (stale epoch)', async () => {
    const h = makeHarness();
    h.gateway.session = clientSession;
    await h.controller.boot();
    const disposedBundle = latestBundleEvents(h);
    await h.controller.signOut();
    expect(h.controller.getState()).toMatchObject({ name: 'signed_out', reason: 'signed_out' });
    expect(h.bundleEvents).toHaveLength(2);

    disposedBundle.onStorageQuarantine(new QuarantineRequiredError('corrupt'));
    await h.controller.settle();

    expect(h.controller.getState()).toMatchObject({ name: 'signed_out', reason: 'signed_out' });
    expect(h.diagnosticsLog).toContainEqual({
      name: 'auth_epoch_stale_event',
      fields: { event: 'STORAGE_QUARANTINE' },
    });
  });

  it('the scrub after a reported quarantine still lands on signed_out(scrubbed) with a fresh client', async () => {
    const h = makeHarness();
    h.gateway.session = clientSession;
    await h.controller.boot();
    latestBundleEvents(h).onStorageQuarantine(new QuarantineRequiredError('corrupt'));
    await h.controller.settle();
    h.gateway.session = null;

    await h.controller.scrubQuarantine();

    expect(h.controller.getState()).toMatchObject({ name: 'signed_out', reason: 'scrubbed' });
    expect(h.storage.scrubbed).toBe(1);
    expect(h.factoryCalls()).toBe(2);
  });
});

describe('first-time TOTP enrollment (PM directive P1 item 3)', () => {
  async function staffAal1AtMfa(h: Harness) {
    h.gateway.session = staffSessionAal1;
    await h.controller.boot();
    expect(h.controller.getState().name).toBe('mfa_required');
  }

  it('enrolls when no verified factor exists and surfaces QR + secret', async () => {
    const h = makeHarness();
    h.gateway.totpFactorId = null;
    await staffAal1AtMfa(h);
    const state = h.controller.getState();
    expect(state).toMatchObject({ name: 'mfa_required' });
    if (state.name === 'mfa_required') {
      expect(state.enrollment?.factorId).toBe('factor-enrolled-synthetic');
      expect(state.enrollment?.secret).toBeTruthy();
    }
    expect(h.gateway.enrolled).toBe(1);
  });

  it('cleans abandoned unverified factors before enrolling again', async () => {
    const h = makeHarness();
    h.gateway.totpFactorId = null;
    h.gateway.unverifiedFactorIds = ['stale-1', 'stale-2'];
    await staffAal1AtMfa(h);
    expect(h.gateway.unenrolled).toEqual(['stale-1', 'stale-2']);
    expect(h.gateway.enrolled).toBe(1);
  });

  it('verifies the enrolled factor and promotes to authorized (AAL2)', async () => {
    const h = makeHarness();
    h.gateway.totpFactorId = null;
    await staffAal1AtMfa(h);
    h.gateway.totpResult = staffSessionAal2;
    await h.controller.submitTotp('654321');
    expect(h.controller.getState().name).toBe('authorized');
  });

  it('a wrong code during enrollment keeps the setup material for retry', async () => {
    const h = makeHarness();
    h.gateway.totpFactorId = null;
    await staffAal1AtMfa(h);
    h.gateway.totpResult = null;
    await h.controller.submitTotp('000000');
    const state = h.controller.getState();
    expect(state).toMatchObject({ name: 'mfa_required', notice: 'auth_invalid' });
    if (state.name === 'mfa_required') {
      expect(state.enrollment?.factorId).toBe('factor-enrolled-synthetic');
    }
  });

  it('a setup failure surfaces a safe notice and retryMfaSetup recovers', async () => {
    const h = makeHarness();
    h.gateway.totpFactorId = null;
    h.gateway.enrollError = new TypeError('Network request failed');
    await staffAal1AtMfa(h);
    expect(h.controller.getState()).toMatchObject({ name: 'mfa_required', notice: 'network' });
    h.gateway.enrollError = null;
    await h.controller.retryMfaSetup();
    const state = h.controller.getState();
    if (state.name === 'mfa_required') {
      expect(state.enrollment?.factorId).toBe('factor-enrolled-synthetic');
    } else {
      throw new Error('expected mfa_required');
    }
  });

  it('relaunch with an existing verified factor verifies without enrolling', async () => {
    const h = makeHarness();
    await staffAal1AtMfa(h); // default fake has a verified factor
    expect(h.gateway.enrolled).toBe(0);
    h.gateway.totpResult = staffSessionAal2;
    await h.controller.submitTotp('654321');
    expect(h.controller.getState().name).toBe('authorized');
  });

  it('cancellation signs out and clears the pending factor', async () => {
    const h = makeHarness();
    h.gateway.totpFactorId = null;
    await staffAal1AtMfa(h);
    await h.controller.signOut();
    expect(h.controller.getState().name).toBe('signed_out');
    await h.controller.submitTotp('654321');
    expect(h.controller.getState().name).toBe('signed_out');
  });

  it('STOPS enrollment when unverified-factor cleanup fails — never accumulates another factor (RETURN-2)', async () => {
    const h = makeHarness();
    h.gateway.totpFactorId = null;
    h.gateway.unverifiedFactorIds = ['stale-1'];
    h.gateway.unenrollError = new TypeError('Network request failed');
    await staffAal1AtMfa(h);
    // Cleanup failed: no new factor may be created.
    expect(h.gateway.enrolled).toBe(0);
    expect(h.controller.getState()).toMatchObject({ name: 'mfa_required', notice: 'network' });
    // Retry after the failure clears: cleanup completes, then one enroll.
    h.gateway.unenrollError = null;
    await h.controller.retryMfaSetup();
    expect(h.gateway.unenrolled).toEqual(['stale-1']);
    expect(h.gateway.enrolled).toBe(1);
  });

  it('repeated cancellation never accumulates factors: each next launch cleans the abandoned one first', async () => {
    // Three enroll → cancel cycles. The abandoned factor stays unverified
    // server-side after each cancel; every following launch must remove it
    // before enrolling, so exactly one live factor ever exists.
    let abandoned: string[] = [];
    const cleaned: string[] = [];
    for (let round = 1; round <= 3; round++) {
      const h = makeHarness();
      h.gateway.session = staffSessionAal1;
      h.gateway.totpFactorId = null;
      h.gateway.unverifiedFactorIds = abandoned;
      await h.controller.boot();
      expect(h.controller.getState().name).toBe('mfa_required');
      expect(h.gateway.enrolled).toBe(1);
      cleaned.push(...h.gateway.unenrolled);
      await h.controller.signOut();
      expect(h.controller.getState().name).toBe('signed_out');
      abandoned = ['factor-enrolled-synthetic'];
    }
    expect(cleaned).toEqual(['factor-enrolled-synthetic', 'factor-enrolled-synthetic']);
  });

  it('interrupted enrollment: a relaunch cleans the abandoned factor and enrolls fresh', async () => {
    const h = makeHarness();
    h.gateway.totpFactorId = null;
    await staffAal1AtMfa(h); // enrollment started, app dies here
    h.gateway.unverifiedFactorIds = ['factor-enrolled-synthetic'];
    const h2 = makeHarness();
    h2.gateway.session = staffSessionAal1;
    h2.gateway.totpFactorId = null;
    h2.gateway.unverifiedFactorIds = h.gateway.unverifiedFactorIds;
    await h2.controller.boot();
    expect(h2.controller.getState().name).toBe('mfa_required');
    expect(h2.gateway.unenrolled).toEqual(['factor-enrolled-synthetic']);
    expect(h2.gateway.enrolled).toBe(1);
  });

  it('factor-limit rejection surfaces as a safe setup notice with retry available', async () => {
    const h = makeHarness();
    h.gateway.totpFactorId = null;
    h.gateway.enrollError = new Error('maximum number of enrolled factors reached');
    await staffAal1AtMfa(h);
    const state = h.controller.getState();
    expect(state.name).toBe('mfa_required');
    if (state.name === 'mfa_required') {
      expect(state.notice).toBeTruthy();
      expect(state.enrollment).toBeUndefined();
    }
    // The limit error itself never reaches the UI verbatim; retry exists.
    h.gateway.enrollError = null;
    await h.controller.retryMfaSetup();
    expect(h.gateway.enrolled).toBe(1);
  });
});

describe('refresh starts without an AppState event (PM directive P1 item 5)', () => {
  it('starts on a cold boot that is already foregrounded', async () => {
    const h = makeHarness({ initialAppStatus: 'active' });
    h.gateway.session = clientSession;
    await h.controller.boot();
    expect(h.controller.getState().name).toBe('authorized');
    expect(h.log).toContain('auth.startAutoRefresh');
  });

  it('starts on first sign-in while active', async () => {
    const h = makeHarness({ initialAppStatus: 'active' });
    await h.controller.boot();
    expect(h.log).not.toContain('auth.startAutoRefresh');
    await h.controller.startSignIn('client.owner@example.invalid');
    h.gateway.verifyResult = clientSession;
    await h.controller.submitOtp('123456');
    expect(h.controller.getState().name).toBe('authorized');
    expect(h.log).toContain('auth.startAutoRefresh');
  });

  it('stops on sign-out and never restarts while signed out', async () => {
    const h = makeHarness({ initialAppStatus: 'active' });
    h.gateway.session = clientSession;
    await h.controller.boot();
    await h.controller.signOut();
    const afterSignOut = h.log.slice(h.log.indexOf('storage.delete'));
    expect(afterSignOut.filter((e) => e === 'auth.startAutoRefresh')).toHaveLength(0);
  });

  it('background stops and resume restarts exactly once', async () => {
    const h = makeHarness({ initialAppStatus: 'active' });
    h.gateway.session = clientSession;
    await h.controller.boot();
    const startsAfterBoot = h.log.filter((e) => e === 'auth.startAutoRefresh').length;
    h.controller.handleAppStateChange('background');
    await h.controller.settle();
    expect(h.log.filter((e) => e === 'auth.stopAutoRefresh').length).toBeGreaterThan(0);
    h.controller.handleAppStateChange('active');
    await h.controller.settle();
    expect(h.log.filter((e) => e === 'auth.startAutoRefresh').length).toBe(startsAfterBoot + 1);
  });

  it('quarantine stops refresh and foreground events never restart it (RETURN-2 area 5)', async () => {
    const h = makeHarness({ initialAppStatus: 'active' });
    h.gateway.session = clientSession;
    h.storage.failDelete = true;
    await h.controller.boot();
    expect(h.controller.getState().name).toBe('authorized');
    expect(h.log).toContain('auth.startAutoRefresh');
    await h.controller.signOut(); // deletion fails → storage_quarantined
    expect(h.controller.getState().name).toBe('storage_quarantined');
    const startsAtQuarantine = h.log.filter((e) => e === 'auth.startAutoRefresh').length;
    // Refresh was stopped on the way down and a foreground ping while
    // quarantined must not bring it back.
    expect(h.log.filter((e) => e === 'auth.stopAutoRefresh').length).toBeGreaterThan(0);
    h.controller.handleAppStateChange('active');
    await h.controller.settle();
    h.controller.handleAppStateChange('background');
    h.controller.handleAppStateChange('active');
    await h.controller.settle();
    expect(h.log.filter((e) => e === 'auth.startAutoRefresh').length).toBe(startsAtQuarantine);
  });
});

// Find 38: membership is server-controlled, so a live session must be
// able to learn that a workspace was revoked underneath it — on the
// desktop, a revoked membership refreshed into "empty", never "stale".
describe('memberships refreshed from the server (find 38)', () => {
  async function authorizedOnA1() {
    const h = makeHarness({ memberships: [membershipA1, membershipA2] });
    h.gateway.session = clientSession;
    await h.controller.boot();
    await h.controller.selectScope(membershipA1.membershipId);
    expect(h.controller.getState().name).toBe('authorized');
    return h;
  }

  it('keeps the bound scope but drops a revoked membership from the list', async () => {
    const h = await authorizedOnA1();
    h.setMemberships([membershipA2]);
    await h.controller.refreshMemberships();
    expect(h.controller.getState()).toMatchObject({
      name: 'authorized',
      scope: { membershipId: membershipA1.membershipId },
      memberships: [membershipA2],
    });
    expect(h.storage.deleted).toBe(0);
  });

  it('signs out with no_access when the last membership is revoked', async () => {
    const h = makeHarness();
    h.gateway.session = clientSession;
    await h.controller.boot();
    expect(h.controller.getState().name).toBe('authorized');
    h.setMemberships([]);
    await h.controller.refreshMemberships();
    expect(h.controller.getState()).toMatchObject({ name: 'signed_out', reason: 'no_access' });
    expect(h.storage.deleted).toBe(1);
    expect(h.log).toContain('auth.signOutRemote');
  });

  it('keeps the current list when the server cannot be read — a failed re-read grants nothing', async () => {
    const h = await authorizedOnA1();
    const before = h.controller.getState();
    h.setMembershipError(new Error('network down'));
    await h.controller.refreshMemberships();
    expect(h.controller.getState()).toBe(before);
  });

  it('an unchanged list is not a transition', async () => {
    const h = await authorizedOnA1();
    const before = h.controller.getState();
    await h.controller.refreshMemberships();
    expect(h.controller.getState()).toBe(before);
  });

  it('switchScope re-reads first, so the chooser never offers a revoked workspace', async () => {
    const h = await authorizedOnA1();
    h.setMemberships([membershipA2]);
    await h.controller.switchScope();
    expect(h.controller.getState()).toMatchObject({
      name: 'select_scope',
      memberships: [membershipA2],
    });
    expect(h.clearLog).toContain('scope_switch');
  });

  it('switchScope with every membership revoked signs out instead of showing an empty chooser', async () => {
    const h = makeHarness();
    h.gateway.session = clientSession;
    await h.controller.boot();
    h.setMemberships([]);
    await h.controller.switchScope();
    expect(h.controller.getState()).toMatchObject({ name: 'signed_out', reason: 'no_access' });
  });

  it('is a no-op outside a scope-holding state', async () => {
    const h = makeHarness();
    await h.controller.boot();
    expect(h.controller.getState().name).toBe('signed_out');
    h.log.length = 0;
    await h.controller.refreshMemberships();
    expect(h.log).not.toContain('memberships.list');
  });
});
