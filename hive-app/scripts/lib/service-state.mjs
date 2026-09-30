/** The service kill switch from the operator's side (WO-007): read the
 * public status, and flip it through the server-role interface
 * (public.set_service_state) with an idempotency key. The privileged key
 * arrives in memory and is never printed. The result names the state, the
 * reason code, the minimum app version, and the status version; nothing
 * else exists to print.
 *
 * Loopback only, unless the caller names the hosted origin it was approved
 * for (WO-011): then the URL must be that origin exactly, which the caller
 * took from security/hosted-targets.json through the operator context. */

const LOOPBACK_HOSTS = ['127.0.0.1', 'localhost', '::1', '[::1]'];
export const SERVICE_STATES = ['open', 'paused'];
export const SERVICE_REASONS = ['none', 'maintenance', 'incident'];
const VERSION = /^\d+\.\d+\.\d+$/;

function guard({ url, serviceKey, approvedOrigin }) {
  if (!url || !serviceKey) return ['url and bearer are required'];
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return ['the URL is not a URL'];
  }
  if (approvedOrigin !== undefined) {
    const exact =
      parsed.origin === approvedOrigin &&
      parsed.protocol === 'https:' &&
      (parsed.pathname === '/' || parsed.pathname === '') &&
      parsed.search === '' &&
      parsed.username === '';
    return exact ? [] : ['the URL is not the approved origin of the hosted target'];
  }
  if (!LOOPBACK_HOSTS.includes(parsed.hostname)) return ['refusing a non-loopback URL'];
  return [];
}

/** The minimum app version a pause or a resume sends: the one the
 * operator named, else the one the service already holds, so that flipping
 * the switch never lowers a floor an incident raised. */
export function keptMinAppVersion(named, currentStatus) {
  if (typeof named === 'string' && named !== '') return named;
  const current = currentStatus?.min_app_version;
  return typeof current === 'string' && VERSION.test(current) ? current : '0.0.0';
}

async function rpc({ url, serviceKey, gatewayKey, fetchImpl }, name, args) {
  const response = await fetchImpl(`${new URL(url).origin}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: gatewayKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  });
  const text = await response.text();
  let body = null;
  try {
    body = text === '' ? null : JSON.parse(text);
  } catch {
    body = null;
  }
  return { ok: response.ok, status: response.status, body };
}

export async function readServiceState({
  url,
  serviceKey,
  gatewayKey = serviceKey,
  approvedOrigin,
  fetchImpl = globalThis.fetch,
}) {
  const problems = guard({ url, serviceKey, approvedOrigin });
  if (problems.length > 0) return { ok: false, problems };
  const result = await rpc({ url, serviceKey, gatewayKey, fetchImpl }, 'service_status_read', {});
  if (!result.ok || typeof result.body?.state !== 'string') {
    return { ok: false, problems: [`service_status_read answered ${result.status}`] };
  }
  return { ok: true, status: result.body };
}

export async function setServiceState({
  url,
  serviceKey,
  gatewayKey = serviceKey,
  approvedOrigin,
  state,
  reasonCode = state === 'open' ? 'none' : 'maintenance',
  minAppVersion = '0.0.0',
  idempotencyKey = crypto.randomUUID(),
  fetchImpl = globalThis.fetch,
}) {
  const problems = guard({ url, serviceKey, approvedOrigin });
  if (!SERVICE_STATES.includes(state))
    problems.push(`state must be one of: ${SERVICE_STATES.join(', ')}`);
  if (!SERVICE_REASONS.includes(reasonCode)) {
    problems.push(`reason must be one of: ${SERVICE_REASONS.join(', ')}`);
  }
  if (!VERSION.test(minAppVersion)) problems.push('minimum app version must be three numbers');
  if (problems.length > 0) return { ok: false, problems };
  const result = await rpc({ url, serviceKey, gatewayKey, fetchImpl }, 'set_service_state', {
    p_state: state,
    p_reason_code: reasonCode,
    p_min_app_version: minAppVersion,
    p_idempotency_key: idempotencyKey,
  });
  if (!result.ok || typeof result.body?.state !== 'string') {
    return {
      ok: false,
      problems: [
        `set_service_state answered ${result.status}${
          typeof result.body?.message === 'string' ? ` (${result.body.message})` : ''
        }`,
      ],
    };
  }
  return { ok: true, status: result.body };
}
