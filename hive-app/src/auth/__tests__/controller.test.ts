import { fixedClock } from '@/core/clock';
import { createDiagnostics, type DiagnosticEventName } from '@/core/diagnostics';
import type { UserId } from '@/core/ids';
import { ScopedRegistry, type ClearReason } from '@/tenancy/clearing';
import type { Membership } from '@/tenancy/types';

import {
  type AuthGateway,
  type AuthListenerEvent,
  type ClientBundle,
  type SessionInfo,
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
  async read(): Promise<string | null> {
    return this.content;
  }
  async write(content: string): Promise<void> {
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

  async getSession(): Promise<SessionInfo | null> {
    this.log.push('auth.getSession');
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
    this.unenrolled.push(factorId);
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
  const controller = new AuthController({
    createBundle: (): ClientBundle => {
      factoryCalls += 1;
      log.push('factory.create');
      return {
        auth: gateway,
        memberships: {
          listMemberships: async (userId) => {
            log.push('memberships.list');
            if (options?.membershipError) throw options.membershipError;
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
});
