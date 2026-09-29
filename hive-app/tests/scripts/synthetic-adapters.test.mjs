import assert from 'node:assert/strict';
import { test } from 'node:test';

import { verifyFilingReceipts } from '../../scripts/lib/filing-verify.mjs';
import {
  referenceArgs,
  resolveLedgerTarget,
  syncLedgerReferences,
} from '../../scripts/lib/ledger-sync.mjs';
import { SYNTHETIC_DOCUMENTS } from '../../scripts/lib/synthetic-documents.mjs';
import {
  HiveSyntheticDrive,
  SYNTHETIC_DRIVE_FILES,
  SYNTHETIC_DRIVE_FOLDER,
  SYNTHETIC_DRIVE_NAME,
} from '../../scripts/lib/synthetic-drive.mjs';
import {
  CASE_REALMS,
  HiveSyntheticLedger,
  SYNTHETIC_LEDGER_NAME,
  SYNTHETIC_REALMS,
} from '../../scripts/lib/synthetic-ledger.mjs';

const HEX64 = /^[0-9a-f]{64}$/;

test('the synthetic ledger adapter is named, read-only, and answers only its fixtures', async () => {
  assert.equal(HiveSyntheticLedger.name, SYNTHETIC_LEDGER_NAME);
  assert.equal(SYNTHETIC_LEDGER_NAME, 'HiveSyntheticLedger');
  // The contract has no write: exactly a name and two reads.
  assert.deepEqual(Object.keys(HiveSyntheticLedger).sort(), [
    'fetchLedgerObject',
    'listObjectsFor',
    'name',
  ]);
  const objects = await HiveSyntheticLedger.listObjectsFor('a1');
  assert.deepEqual(objects.map((object) => object.objectType).sort(), [
    'Account',
    'JournalEntry',
    'Report',
  ]);
  for (const object of objects) {
    assert.match(object.displayName, /\(Synthetic\)$/);
    assert.match(object.digest, HEX64);
    assert.match(object.asOf, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    assert.equal(typeof object.objectVersion, 'string');
    // Never a value: no amount, balance, or account number is part of the shape.
    assert.ok(!Object.keys(object).some((key) => /amount|balance|number|total/i.test(key)));
  }
  const account = objects.find((object) => object.objectType === 'Account');
  assert.deepEqual(
    await HiveSyntheticLedger.fetchLedgerObject(
      SYNTHETIC_REALMS.a1,
      'Account',
      'acct-synthetic-operating',
    ),
    account,
  );
  assert.equal(
    await HiveSyntheticLedger.fetchLedgerObject(SYNTHETIC_REALMS.a1, 'Account', 'acct-real'),
    null,
  );
  assert.equal(await HiveSyntheticLedger.fetchLedgerObject('realm-other', 'Account', 'x'), null);
  await assert.rejects(() => HiveSyntheticLedger.listObjectsFor('b1'), /unknown case key/);
  // A digest names exactly one state of one object.
  const again = await HiveSyntheticLedger.listObjectsFor('a1');
  assert.deepEqual(again, objects);
  assert.equal(new Set(objects.map((object) => object.digest)).size, objects.length);
  assert.equal(CASE_REALMS.a1.caseId, 'eeeeeeee-0000-4000-8000-0000000000a1');
});

test('the synthetic record adapter is named, read-only, and its digests restate the seeded documents', async () => {
  assert.equal(HiveSyntheticDrive.name, SYNTHETIC_DRIVE_NAME);
  assert.equal(SYNTHETIC_DRIVE_NAME, 'HiveSyntheticDrive');
  // The contract has no write, move, delete, or share: a name and one check.
  assert.deepEqual(Object.keys(HiveSyntheticDrive).sort(), ['checkFile', 'name']);
  const seededById = new Map(SYNTHETIC_DOCUMENTS.map((row) => [row.id, row]));
  for (const [fileId, entry] of Object.entries(SYNTHETIC_DRIVE_FILES)) {
    const checked = await HiveSyntheticDrive.checkFile(fileId);
    assert.equal(checked.found, true);
    assert.equal(checked.digest, entry.digest);
    assert.ok(checked.path.startsWith(`${SYNTHETIC_DRIVE_FOLDER}/`));
    assert.match(checked.digest, HEX64);
    if (entry.documentId) {
      const seeded = seededById.get(entry.documentId);
      assert.ok(seeded, `${fileId} names a seeded document`);
      assert.equal(checked.digest, seeded.client_digest, `${fileId} holds its document's bytes`);
      assert.equal(seeded.status, 'ACCEPTED');
    }
  }
  const wrong = await HiveSyntheticDrive.checkFile('drv-synthetic-wrong');
  assert.equal(wrong.found, true);
  assert.equal(SYNTHETIC_DRIVE_FILES['drv-synthetic-wrong'].documentId, null);
  assert.ok(
    ![...seededById.values()].some((row) => row.client_digest === wrong.digest),
    'the wrong file holds no seeded document’s bytes',
  );
  assert.deepEqual(await HiveSyntheticDrive.checkFile('drv-not-there'), { found: false });
  assert.match(SYNTHETIC_DRIVE_FOLDER, /\(Synthetic\)/);
});

function fakeFetch(answer) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({
      url: String(url),
      method: options.method ?? 'GET',
      body,
      headers: options.headers,
    });
    const reply = answer(calls.length, String(url), body);
    return {
      ok: reply.status < 400,
      status: reply.status,
      text: async () => JSON.stringify(reply.body),
    };
  };
  return { fetchImpl, calls };
}

test('syncLedgerReferences records each fixture through the server-role interface, named to the adapter, and reports replays', async () => {
  const { fetchImpl, calls } = fakeFetch((n) => ({
    status: 200,
    body: { reference_id: `ref-${n}`, replayed: n > 3 },
  }));
  const first = await syncLedgerReferences({
    url: 'http://127.0.0.1:54321',
    serviceKey: 'service-bearer-in-memory',
    gatewayKey: 'issued-gateway-key',
    caseKey: 'a1',
    fetchImpl,
  });
  assert.equal(first.ok, true);
  assert.equal(first.results.length, 3);
  assert.deepEqual(
    first.results.map((entry) => entry.referenceId),
    ['ref-1', 'ref-2', 'ref-3'],
  );
  assert.ok(first.results.every((entry) => entry.replayed === false));
  for (const call of calls) {
    assert.equal(call.url, 'http://127.0.0.1:54321/rest/v1/rpc/record_ledger_reference');
    assert.equal(call.method, 'POST');
    assert.equal(call.headers.Authorization, 'Bearer service-bearer-in-memory');
    assert.equal(call.headers.apikey, 'issued-gateway-key');
    assert.equal(call.body.p_case_id, 'eeeeeeee-0000-4000-8000-0000000000a1');
    assert.equal(call.body.p_realm_id, 'realm-synthetic-a1');
    assert.equal(call.body.p_adapter_name, 'HiveSyntheticLedger');
    assert.match(call.body.p_object_digest, HEX64);
  }
  const second = await syncLedgerReferences({
    url: 'http://127.0.0.1:54321',
    serviceKey: 'service-bearer-in-memory',
    caseKey: 'a1',
    fetchImpl,
  });
  assert.ok(second.results.every((entry) => entry.replayed === true));

  const objects = await HiveSyntheticLedger.listObjectsFor('a1');
  assert.deepEqual(referenceArgs(resolveLedgerTarget('a1'), objects[0], 'X'), {
    p_case_id: 'eeeeeeee-0000-4000-8000-0000000000a1',
    p_realm_id: 'realm-synthetic-a1',
    p_object_type: objects[0].objectType,
    p_object_id: objects[0].objectId,
    p_object_version: objects[0].objectVersion,
    p_display_name: objects[0].displayName,
    p_as_of: objects[0].asOf,
    p_object_digest: objects[0].digest,
    p_adapter_name: 'X',
  });
  assert.match(resolveLedgerTarget('b1').problem, /unknown case key/);
  const refusedKey = await syncLedgerReferences({
    url: 'http://127.0.0.1:54321',
    serviceKey: 'k',
    caseKey: 'eeeeeeee-0000-4000-8000-0000000000a1',
    fetchImpl,
  });
  assert.equal(refusedKey.ok, false);
  const refusedHost = await syncLedgerReferences({
    url: 'https://db.example.invalid',
    serviceKey: 'k',
    caseKey: 'a1',
    fetchImpl,
  });
  assert.equal(refusedHost.ok, false);
  assert.match(refusedHost.problems[0], /non-loopback/);
  const denied = fakeFetch(() => ({ status: 403, body: { message: 'permission denied' } }));
  const failed = await syncLedgerReferences({
    url: 'http://127.0.0.1:54321',
    serviceKey: 'k',
    caseKey: 'a1',
    fetchImpl: denied.fetchImpl,
  });
  assert.equal(failed.ok, false);
  assert.match(failed.problems[0], /answered 403/);
});

test('verifyFilingReceipts reads the recorded receipts, asks the adapter, and settles each through the server role, never writing to the record', async () => {
  const rows = [
    { id: 'rcpt-1', drive_file_id: 'drv-synthetic-0001' },
    { id: 'rcpt-2', drive_file_id: 'drv-synthetic-wrong' },
    { id: 'rcpt-3', drive_file_id: 'drv-not-there' },
  ];
  const { fetchImpl, calls } = fakeFetch((n, url, body) => {
    if (url.includes('/filing_receipts?')) return { status: 200, body: rows };
    const row = rows.find((candidate) => candidate.id === body.p_receipt_id);
    const status =
      body.p_found_digest === SYNTHETIC_DRIVE_FILES[row.drive_file_id]?.digest &&
      row.drive_file_id === 'drv-synthetic-0001'
        ? 'VERIFIED'
        : 'MISMATCH';
    return { status: 200, body: { receipt_id: body.p_receipt_id, status, replayed: false } };
  });
  const result = await verifyFilingReceipts({
    url: 'http://127.0.0.1:54321',
    serviceKey: 'service-bearer-in-memory',
    gatewayKey: 'issued-gateway-key',
    caseId: 'eeeeeeee-0000-4000-8000-0000000000a1',
    fetchImpl,
  });
  assert.equal(result.ok, true);
  assert.equal(result.adapter, 'HiveSyntheticDrive');
  assert.deepEqual(
    result.results.map((entry) => [entry.receiptId, entry.found, entry.status]),
    [
      ['rcpt-1', true, 'VERIFIED'],
      ['rcpt-2', true, 'MISMATCH'],
      ['rcpt-3', false, 'MISMATCH'],
    ],
  );
  const [read, ...verifies] = calls;
  assert.equal(read.method, 'GET');
  assert.ok(read.url.includes('status=eq.RECORDED'));
  assert.ok(read.url.includes('case_id=eq.eeeeeeee-0000-4000-8000-0000000000a1'));
  assert.equal(verifies.length, 3);
  for (const call of verifies) {
    assert.equal(call.url, 'http://127.0.0.1:54321/rest/v1/rpc/verify_filing_receipt');
    assert.equal(call.method, 'POST');
    assert.equal(call.body.p_adapter_name, 'HiveSyntheticDrive');
    assert.equal(call.headers.Authorization, 'Bearer service-bearer-in-memory');
  }
  assert.equal(verifies[0].body.p_found_digest, SYNTHETIC_DRIVE_FILES['drv-synthetic-0001'].digest);
  assert.equal(
    verifies[1].body.p_found_digest,
    SYNTHETIC_DRIVE_FILES['drv-synthetic-wrong'].digest,
  );
  assert.equal(verifies[2].body.p_found_digest, null);
  // Only reads and the verification rpc: no PATCH, PUT, or DELETE anywhere.
  assert.ok(calls.every((call) => call.method === 'GET' || call.method === 'POST'));
  assert.ok(calls.every((call) => !call.url.includes('/storage/')));

  const refused = await verifyFilingReceipts({
    url: 'https://drive.example.invalid',
    serviceKey: 'k',
    fetchImpl,
  });
  assert.equal(refused.ok, false);
  const unreadable = fakeFetch(() => ({ status: 500, body: null }));
  const failed = await verifyFilingReceipts({
    url: 'http://127.0.0.1:54321',
    serviceKey: 'k',
    fetchImpl: unreadable.fetchImpl,
  });
  assert.equal(failed.ok, false);
  assert.match(failed.problems[0], /could not be read/);
});
