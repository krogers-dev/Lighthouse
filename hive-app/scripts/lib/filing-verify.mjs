/** verifyFilingReceipts — the NAMED synthetic permanent-record adapter's
 * read-only check of every RECORDED filing receipt, through the
 * server-role adapter interface (WO-006: public.verify_filing_receipt,
 * executable by the server role alone). The adapter answers whether the
 * Drive object holds the claimed bytes; the server records VERIFIED or
 * MISMATCH (a missing object is a MISMATCH: a filing nobody can check is
 * not verified by default). Nothing in the record is ever written,
 * moved, deleted, or shared.
 *
 * Loopback only; the privileged bearer arrives in memory and is never
 * printed. The result names receipt ids and outcomes; no path, no digest.
 */
import { HiveSyntheticDrive } from './synthetic-drive.mjs';

const LOOPBACK_HOSTS = ['127.0.0.1', 'localhost', '::1', '[::1]'];

export async function verifyFilingReceipts({
  url,
  serviceKey,
  gatewayKey = serviceKey,
  caseId = null,
  adapter = HiveSyntheticDrive,
  fetchImpl = globalThis.fetch,
}) {
  if (!url || !serviceKey) return { ok: false, problems: ['url and bearer are required'] };
  if (!LOOPBACK_HOSTS.includes(new URL(url).hostname)) {
    return { ok: false, problems: ['refusing a non-loopback URL'] };
  }
  const headers = {
    apikey: gatewayKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
  };
  const call = async (pathname, options = {}) => {
    const response = await fetchImpl(`${url}/rest/v1${pathname}`, { ...options, headers });
    const text = await response.text();
    let body = null;
    try {
      body = text === '' ? null : JSON.parse(text);
    } catch {
      body = null;
    }
    return { ok: response.ok, status: response.status, body };
  };

  const pending = await call(
    `/filing_receipts?select=id,drive_file_id&status=eq.RECORDED${
      caseId ? `&case_id=eq.${caseId}` : ''
    }&order=filed_at.asc`,
  );
  if (!pending.ok || !Array.isArray(pending.body)) {
    return { ok: false, problems: [`filing_receipts could not be read (${pending.status})`] };
  }

  const results = [];
  for (const row of pending.body) {
    const checked = await adapter.checkFile(row.drive_file_id);
    const verified = await call('/rpc/verify_filing_receipt', {
      method: 'POST',
      body: JSON.stringify({
        p_receipt_id: row.id,
        p_found_digest: checked.found ? checked.digest : null,
        p_adapter_name: adapter.name,
      }),
    });
    if (!verified.ok || typeof verified.body?.status !== 'string') {
      return {
        ok: false,
        problems: [
          `verify_filing_receipt answered ${verified.status} for ${row.id}${
            typeof verified.body?.message === 'string' ? ` (${verified.body.message})` : ''
          }`,
        ],
        results,
      };
    }
    results.push({
      receiptId: row.id,
      found: checked.found === true,
      status: verified.body.status,
      replayed: verified.body.replayed === true,
    });
  }
  return { ok: true, adapter: adapter.name, results };
}
