/** The service status the app reads before anything else (WO-007).
 *
 * One public read through one server function: whether HIVE is open or
 * paused, why (a code, never text), and the minimum app version. No user
 * data travels either way; the read needs no sign-in. The decision rule:
 * a readable "paused" or an app older than the minimum interrupts the
 * app with an explicit state; an UNREADABLE status lets the app proceed,
 * because the server refuses every protected read and transition on its
 * own while paused (the restrictive service gate), so the screen here is
 * the explanation, never the control. */

export type ServiceState = 'open' | 'paused';
export type ServiceReason = 'none' | 'maintenance' | 'incident';

export interface ServiceStatus {
  readonly state: ServiceState;
  readonly reasonCode: ServiceReason;
  readonly minAppVersion: string;
  readonly version: number;
}

export type ServiceGateDecision =
  | { readonly name: 'open' }
  | { readonly name: 'paused'; readonly reason: ServiceReason }
  | { readonly name: 'update_required'; readonly minAppVersion: string };

const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

function isState(value: unknown): value is ServiceState {
  return value === 'open' || value === 'paused';
}

function isReason(value: unknown): value is ServiceReason {
  return value === 'none' || value === 'maintenance' || value === 'incident';
}

/** Defensive: anything that is not exactly the documented shape is null,
 * and null proceeds (see the header). */
export function decodeServiceStatus(value: unknown): ServiceStatus | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  const state = v['state'];
  const reason = v['reason_code'];
  const minAppVersion = v['min_app_version'];
  const version = v['version'];
  if (!isState(state) || !isReason(reason)) return null;
  if (typeof minAppVersion !== 'string' || !VERSION_PATTERN.test(minAppVersion)) return null;
  if (typeof version !== 'number' || !Number.isInteger(version)) return null;
  return { state, reasonCode: reason, minAppVersion, version };
}

/** Numeric dotted comparison; a malformed version counts as 0.0.0, so a
 * build with no version is the oldest there is. */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const parse = (value: string): number[] =>
    VERSION_PATTERN.test(value) ? value.split('.').map((part) => Number(part)) : [0, 0, 0];
  const left = parse(a);
  const right = parse(b);
  for (let i = 0; i < 3; i += 1) {
    const l = left[i] ?? 0;
    const r = right[i] ?? 0;
    if (l < r) return -1;
    if (l > r) return 1;
  }
  return 0;
}

export function decideServiceGate(
  status: ServiceStatus | null,
  appVersion: string,
): ServiceGateDecision {
  if (!status) return { name: 'open' };
  if (status.state === 'paused') return { name: 'paused', reason: status.reasonCode };
  if (compareVersions(appVersion, status.minAppVersion) < 0) {
    return { name: 'update_required', minAppVersion: status.minAppVersion };
  }
  return { name: 'open' };
}

export interface ServiceStatusSource {
  readonly supabaseUrl: string;
  readonly supabaseClientKey: string;
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export const SERVICE_STATUS_TIMEOUT_MS = 5000;

/** The read: the public client key identifies the app, nothing identifies
 * the person. A failure of any kind is null. */
export async function readServiceStatus(
  source: ServiceStatusSource,
  fetchImpl: FetchLike = (input, init) => fetch(input, init),
  timeoutMs: number = SERVICE_STATUS_TIMEOUT_MS,
): Promise<ServiceStatus | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${source.supabaseUrl}/rest/v1/rpc/service_status_read`, {
      method: 'POST',
      headers: {
        apikey: source.supabaseClientKey,
        Authorization: `Bearer ${source.supabaseClientKey}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
      signal: controller.signal,
    });
    if (!response.ok) return null;
    return decodeServiceStatus(await response.json());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
