/** syncLedgerReferences — record what the NAMED synthetic ledger adapter
 * reads for a seeded case, through the server-role adapter interface
 * (WO-006: public.record_ledger_reference, executable by the server role
 * alone). Read-only toward the ledger by construction: the adapter
 * contract has no write. Idempotent toward HIVE: a reference already on
 * record replays its id.
 *
 * Loopback only; the privileged bearer arrives in memory and is never
 * printed. The result names ids, object identifiers, and outcomes; no
 * value, and no digest, is part of it.
 */
import { CASE_REALMS, HiveSyntheticLedger } from './synthetic-ledger.mjs';

const LOOPBACK_HOSTS = ['127.0.0.1', 'localhost', '::1', '[::1]'];

export function resolveLedgerTarget(caseKey) {
  const target = CASE_REALMS[caseKey];
  if (!target) {
    return {
      problem: `unknown case key ${JSON.stringify(caseKey)}; one of: ${Object.keys(CASE_REALMS).join(', ')}`,
    };
  }
  return { key: caseKey, caseId: target.caseId, realm: target.realm };
}

/** The arguments one reference records, exactly as the server function
 * names them. */
export function referenceArgs(target, object, adapterName) {
  return {
    p_case_id: target.caseId,
    p_realm_id: target.realm,
    p_object_type: object.objectType,
    p_object_id: object.objectId,
    p_object_version: object.objectVersion,
    p_display_name: object.displayName,
    p_as_of: object.asOf,
    p_object_digest: object.digest,
    p_adapter_name: adapterName,
  };
}

export async function syncLedgerReferences({
  url,
  serviceKey,
  gatewayKey = serviceKey,
  caseKey,
  adapter = HiveSyntheticLedger,
  fetchImpl = globalThis.fetch,
}) {
  const problems = [];
  if (!url || !serviceKey) return { ok: false, problems: ['url and bearer are required'] };
  if (!LOOPBACK_HOSTS.includes(new URL(url).hostname)) {
    return { ok: false, problems: ['refusing a non-loopback URL'] };
  }
  const target = resolveLedgerTarget(caseKey);
  if (target.problem) return { ok: false, problems: [target.problem] };

  const objects = await adapter.listObjectsFor(caseKey);
  const results = [];
  for (const object of objects) {
    const response = await fetchImpl(`${url}/rest/v1/rpc/record_ledger_reference`, {
      method: 'POST',
      headers: {
        apikey: gatewayKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(referenceArgs(target, object, adapter.name)),
    });
    const text = await response.text();
    let body = null;
    try {
      body = text === '' ? null : JSON.parse(text);
    } catch {
      body = null;
    }
    if (!response.ok || typeof body?.reference_id !== 'string') {
      problems.push(
        `record_ledger_reference answered ${response.status} for ${object.objectType} ${object.objectId}${
          typeof body?.message === 'string' ? ` (${body.message})` : ''
        }`,
      );
      return { ok: false, problems, results };
    }
    results.push({
      objectType: object.objectType,
      objectId: object.objectId,
      objectVersion: object.objectVersion,
      referenceId: body.reference_id,
      replayed: body.replayed === true,
    });
  }
  return { ok: true, key: target.key, caseId: target.caseId, adapter: adapter.name, results };
}
