/** The service kill switch from the operator's side (WO-007): read the
 * public status, and flip it through the server-role interface
 * (public.set_service_state) with an idempotency key. Loopback only; the
 * privileged bearer arrives in memory and is never printed. The result
 * names the state, the reason code, the minimum app version, and the
 * status version; nothing else exists to print. */

const LOOPBACK_HOSTS = ['127.0.0.1', 'localhost', '::1', '[::1]'];
export const SERVICE_STATES = ['open', 'paused'];
export const SERVICE_REASONS = ['none', 'maintenance', 'incident'];

function guard({ url, serviceKey }) {
  if (!url || !serviceKey) return ['url and bearer are required'];
  if (!LOOPBACK_HOSTS.includes(new URL(url).hostname)) return ['refusing a non-loopback URL'];
  return [];
}

async function rpc({ url, serviceKey, gatewayKey, fetchImpl }, name, args) {
  const response = await fetchImpl(`${url}/rest/v1/rpc/${name}`, {
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
  fetchImpl = globalThis.fetch,
}) {
  const problems = guard({ url, serviceKey });
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
  state,
  reasonCode = state === 'open' ? 'none' : 'maintenance',
  minAppVersion = '0.0.0',
  idempotencyKey = crypto.randomUUID(),
  fetchImpl = globalThis.fetch,
}) {
  const problems = guard({ url, serviceKey });
  if (!SERVICE_STATES.includes(state))
    problems.push(`state must be one of: ${SERVICE_STATES.join(', ')}`);
  if (!SERVICE_REASONS.includes(reasonCode)) {
    problems.push(`reason must be one of: ${SERVICE_REASONS.join(', ')}`);
  }
  if (!/^\d+\.\d+\.\d+$/.test(minAppVersion))
    problems.push('minimum app version must be three numbers');
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
