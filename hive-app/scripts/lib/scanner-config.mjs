/** The scanner runner's configuration, read from its environment and
 * refused when anything is off (WO-015). Pure, so every refusal is
 * provable without a daemon or a network.
 *
 * The runner speaks to exactly one Supabase project: a loopback stack
 * (the local lane, any scheme, any issued key) or one of the hosted
 * projects the manifest names, by its exact origin, with the new secret
 * key shape and nothing else — never a legacy service-role token, never
 * an origin typed by hand. clamd is reached over TCP on a private
 * network; the runner never listens on anything.
 */
import { isSecretKeyShape, originMatches } from './hosted-targets.mjs';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

export const DEFAULTS = Object.freeze({
  clamdHost: '127.0.0.1',
  clamdPort: 3310,
  intervalMs: 30_000,
  batch: 20,
  scanTimeoutMs: 120_000,
});

export function isLoopbackUrl(value) {
  try {
    return LOOPBACK_HOSTS.has(new URL(value).hostname);
  } catch {
    return false;
  }
}

function positiveInteger(raw, name, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (typeof raw === 'undefined' || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

/** Resolve the runner's configuration or throw the first problem.
 *
 * `manifest` is the parsed `security/hosted-targets.json` (its `targets`
 * carry `origin`); without it only a loopback URL is accepted. */
export function resolveScannerConfig(env, manifest = null) {
  const url = (env.HIVE_SCANNER_SUPABASE_URL ?? '').trim();
  if (url === '') throw new Error('HIVE_SCANNER_SUPABASE_URL is required');
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('HIVE_SCANNER_SUPABASE_URL is not a URL');
  }
  const loopback = isLoopbackUrl(url);
  const secretKey = (env.HIVE_SCANNER_SECRET_KEY ?? '').trim();
  if (secretKey === '') throw new Error('HIVE_SCANNER_SECRET_KEY is required');
  let targetName = 'loopback';
  if (!loopback) {
    if (parsed.protocol !== 'https:') {
      throw new Error('a hosted project is reached over https only');
    }
    const targets = Object.entries(manifest?.targets ?? {});
    const match = targets.find(([, target]) => target && originMatches(url, target));
    if (!match) {
      throw new Error(
        'HIVE_SCANNER_SUPABASE_URL is not the exact origin of a project in security/hosted-targets.json',
      );
    }
    targetName = match[0];
    if (!isSecretKeyShape(secretKey)) {
      throw new Error(
        'HIVE_SCANNER_SECRET_KEY must be the project secret key (sb_secret_…); a legacy service-role token is refused',
      );
    }
  }
  const gatewayKey = (env.HIVE_SCANNER_GATEWAY_KEY ?? '').trim() || secretKey;
  const clamdHost = (env.HIVE_SCANNER_CLAMD_HOST ?? '').trim() || DEFAULTS.clamdHost;
  if (!/^[A-Za-z0-9.:\-[\]]+$/.test(clamdHost)) {
    throw new Error('HIVE_SCANNER_CLAMD_HOST must be a host name or address');
  }
  const clamdPort = positiveInteger(
    env.HIVE_SCANNER_CLAMD_PORT,
    'HIVE_SCANNER_CLAMD_PORT',
    DEFAULTS.clamdPort,
    {
      max: 65535,
    },
  );
  const once = env.HIVE_SCANNER_ONCE === '1';
  const intervalMs = positiveInteger(
    env.HIVE_SCANNER_INTERVAL_MS,
    'HIVE_SCANNER_INTERVAL_MS',
    DEFAULTS.intervalMs,
    {
      min: 1000,
      max: 3_600_000,
    },
  );
  const batch = positiveInteger(env.HIVE_SCANNER_BATCH, 'HIVE_SCANNER_BATCH', DEFAULTS.batch, {
    max: 200,
  });
  const scanTimeoutMs = positiveInteger(
    env.HIVE_SCANNER_SCAN_TIMEOUT_MS,
    'HIVE_SCANNER_SCAN_TIMEOUT_MS',
    DEFAULTS.scanTimeoutMs,
    { min: 1000, max: 600_000 },
  );
  return {
    url: parsed.origin,
    targetName,
    loopback,
    secretKey,
    gatewayKey,
    clamdHost,
    clamdPort,
    once,
    intervalMs,
    batch,
    scanTimeoutMs,
  };
}

/** What the runner may print about its configuration: no key, no
 * fragment of a key. */
export function describeScannerConfig(config) {
  return `scanner: ${config.targetName} (${config.url}), clamd ${config.clamdHost}:${config.clamdPort}, ${
    config.once ? 'one pass' : `every ${config.intervalMs}ms`
  }, batches of ${config.batch}`;
}
