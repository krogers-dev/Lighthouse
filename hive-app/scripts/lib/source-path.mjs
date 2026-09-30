/** The source adapters' path (WO-006) as real JWTs over PostgREST plus
 * the server-role adapter interface, for the black-box harness
 * (scripts/e2e-local-auth.mjs step 4c), run right after the review path
 * left the seeded case APPROVED.
 *
 * The named synthetic ledger adapter records read-only references for
 * the case through the server role, and a second sync replays them;
 * staff of the scope at AAL2 read them, a client and staff at AAL1 read
 * none. Intake records a filing receipt at AAL2 for an approved, checked
 * document at the synthetic Drive file that holds its bytes, meets every
 * refusal on the way (a client, AAL1, a stale version, a rejected
 * document, a bad file id, an empty path, a duplicate), and the same key
 * replays the same receipt. The named synthetic record adapter then
 * verifies both receipts read-only: one VERIFIED, one MISMATCH. The case
 * itself does not move, the client sees only the enumerated trail, and
 * the rows are counted into the exact-reach sets of the staff who may
 * see them.
 */
import { SYNTHETIC_DRIVE_FOLDER, SYNTHETIC_DRIVE_NAME } from './synthetic-drive.mjs';
import { SYNTHETIC_LEDGER_NAME } from './synthetic-ledger.mjs';

const SOURCE_EVENT_KINDS = [
  'source.referenced',
  'record.filed',
  'record.verified',
  'record.mismatch',
];

export async function assertSourcePath(ctx, parties) {
  const {
    rest,
    rpc,
    check,
    uuidV4,
    extraReach,
    extraReachByEmail,
    SCOPE,
    CASES,
    DOCUMENTS,
    sync,
    verify,
  } = ctx;
  const { intake, intakeAal1, preparer, client, other } = parties;

  const readCase = async (token) => {
    const row = await rest(`/cases?select=id,status,version&id=eq.${CASES.a1}`, token);
    return row.body?.[0] ?? null;
  };
  const staffOf = (email) => (extraReachByEmail[email] ??= {});
  const noteRows = (table, id) => {
    for (const email of [preparer.email, 'mixed.same@example.invalid']) {
      (staffOf(email)[table] ??= []).push(id);
    }
  };

  const current = await readCase(intake.token);
  if (
    !check(
      current?.status === 'APPROVED',
      `${intake.email}: case A1 stands APPROVED for the source path`,
    )
  ) {
    return;
  }

  // The ledger: the adapter interface is the server role's alone.
  const referenceArgs = {
    p_case_id: CASES.a1,
    p_realm_id: 'realm-synthetic-a1',
    p_object_type: 'Account',
    p_object_id: 'acct-synthetic-operating',
    p_object_version: '3',
    p_display_name: 'Operating account (Synthetic)',
    p_as_of: '2026-09-28T12:00:00Z',
    p_object_digest: '0'.repeat(64),
    p_adapter_name: 'not-the-server',
  };
  const clientSync = await rpc('record_ledger_reference', referenceArgs, client.token);
  check(
    clientSync.status === 403 || clientSync.status === 401,
    `${client.email}: a client cannot record a ledger reference (${clientSync.status})`,
  );
  const intakeSync = await rpc('record_ledger_reference', referenceArgs, intake.token);
  check(
    intakeSync.status === 403 || intakeSync.status === 401,
    `${intake.email}: staff cannot record a ledger reference; the interface is the server role's (${intakeSync.status})`,
  );
  const synced = await sync();
  if (
    !check(
      synced.ok && synced.results.length === 3 && synced.results.every((entry) => !entry.replayed),
      `server role: ${SYNTHETIC_LEDGER_NAME} records three references for A1`,
    )
  ) {
    return;
  }
  const syncedAgain = await sync();
  check(
    syncedAgain.ok &&
      syncedAgain.results.length === 3 &&
      syncedAgain.results.every(
        (entry, index) => entry.replayed && entry.referenceId === synced.results[index].referenceId,
      ),
    'server role: a second sync replays the same references, never a duplicate',
  );
  for (const entry of synced.results) noteRows('ledger_references', entry.referenceId);
  const intakeReferences = await rest(
    `/ledger_references?select=id,object_type,display_name,adapter_name&case_id=eq.${CASES.a1}`,
    intake.token,
  );
  check(
    intakeReferences.status === 200 &&
      (intakeReferences.body ?? []).length === 3 &&
      intakeReferences.body.every((row) => row.adapter_name === SYNTHETIC_LEDGER_NAME),
    `${intake.email}: staff of the scope at AAL2 read the three references, each named to the adapter`,
  );
  const clientReferences = await rest(
    `/ledger_references?select=id&case_id=eq.${CASES.a1}`,
    client.token,
  );
  check(
    clientReferences.status === 200 && (clientReferences.body ?? []).length === 0,
    `${client.email}: a client reads no ledger reference (zero rows)`,
  );
  const aal1References = await rest(
    `/ledger_references?select=id&case_id=eq.${CASES.a1}`,
    intakeAal1.token,
  );
  check(
    aal1References.status === 200 && (aal1References.body ?? []).length === 0,
    `${intakeAal1.email}: staff at AAL1 read no ledger reference (zero rows)`,
  );
  const otherReferences = await rest(
    `/ledger_references?select=id&case_id=eq.${CASES.a1}`,
    other.token,
  );
  check(
    otherReferences.status === 200 && (otherReferences.body ?? []).length === 0,
    `${other.email}: another client reads no ledger reference (zero rows)`,
  );

  // The record: intake files by hand and records a receipt; the server binds it.
  const scopeArgs = {
    p_environment_id: SCOPE.environmentId,
    p_client_id: SCOPE.clientA,
    p_entity_id: SCOPE.entityA1,
    p_case_id: CASES.a1,
  };
  const file = (token, version, extra) =>
    rpc(
      'record_filing_receipt',
      {
        ...scopeArgs,
        p_case_version: version,
        p_idempotency_key: uuidV4(),
        p_document_id: DOCUMENTS.a1Accepted,
        p_drive_file_id: 'drv-synthetic-0001',
        p_drive_path: SYNTHETIC_DRIVE_FOLDER,
        ...extra,
      },
      token,
    );
  const clientFile = await file(client.token, current.version, {});
  check(
    clientFile.status === 403,
    `${client.email}: a client cannot record a filing receipt (403)`,
  );
  const aal1File = await file(intakeAal1.token, current.version, {});
  check(
    aal1File.status === 403,
    `${intakeAal1.email}: staff at AAL1 cannot record a filing receipt (403)`,
  );
  const stale = await file(intake.token, current.version + 5, {});
  check(
    stale.status === 400 && stale.body?.message === 'case_changed',
    `${intake.email}: a stale case version is a conflict (case_changed)`,
  );
  const rejected = await file(intake.token, current.version, {
    p_document_id: DOCUMENTS.a1Rejected,
  });
  check(
    rejected.status === 400 && rejected.body?.message === 'document_not_filable',
    `${intake.email}: a rejected document is not filable (document_not_filable)`,
  );
  const badId = await file(intake.token, current.version, { p_drive_file_id: 'has space' });
  check(
    badId.status === 400 && badId.body?.message === 'invalid_file_id',
    `${intake.email}: a Drive file id has one shape (invalid_file_id)`,
  );
  const badPath = await file(intake.token, current.version, { p_drive_path: '   ' });
  check(
    badPath.status === 400 && badPath.body?.message === 'invalid_path',
    `${intake.email}: a Drive path is bounded and printable (invalid_path)`,
  );
  const fileKey = uuidV4();
  const fileArgs = {
    ...scopeArgs,
    p_case_version: current.version,
    p_idempotency_key: fileKey,
    p_document_id: DOCUMENTS.a1Accepted,
    p_drive_file_id: 'drv-synthetic-0001',
    p_drive_path: SYNTHETIC_DRIVE_FOLDER,
  };
  const filed = await rpc('record_filing_receipt', fileArgs, intake.token);
  if (
    !check(
      filed.status === 200 &&
        filed.body?.status === 'RECORDED' &&
        /^[0-9a-f]{64}$/.test(filed.body?.claimed_digest ?? '') &&
        filed.body?.case_version === current.version,
      `${intake.email}: the receipt is RECORDED, claiming the document's checked digest, on the same case version`,
    )
  ) {
    return;
  }
  noteRows('filing_receipts', filed.body.receipt_id);
  const replay = await rpc('record_filing_receipt', fileArgs, intake.token);
  check(
    replay.status === 200 && replay.body?.receipt_id === filed.body.receipt_id,
    `${intake.email}: the same key replays the same receipt`,
  );
  const duplicate = await file(intake.token, current.version, {});
  check(
    duplicate.status === 400 && duplicate.body?.message === 'receipt_exists',
    `${intake.email}: a second receipt for the same document at the same file is refused (receipt_exists)`,
  );
  const second = await file(intake.token, current.version, {
    p_document_id: DOCUMENTS.a2Accepted,
    p_drive_file_id: 'drv-synthetic-wrong',
  });
  check(
    second.status === 200 && second.body?.status === 'RECORDED',
    `${intake.email}: another checked document's receipt at another file is recorded`,
  );
  if (second.status === 200) noteRows('filing_receipts', second.body.receipt_id);
  const clientReceipts = await rest(
    `/filing_receipts?select=id&case_id=eq.${CASES.a1}`,
    client.token,
  );
  check(
    clientReceipts.status === 200 && (clientReceipts.body ?? []).length === 0,
    `${client.email}: a client reads no filing receipt (zero rows)`,
  );
  const preparerReceipts = await rest(
    `/filing_receipts?select=id,status&case_id=eq.${CASES.a1}`,
    preparer.token,
  );
  check(
    preparerReceipts.status === 200 &&
      (preparerReceipts.body ?? []).length === 2 &&
      preparerReceipts.body.every((row) => row.status === 'RECORDED'),
    `${preparer.email}: staff of the scope read both receipts, RECORDED until verified`,
  );

  // Verification: read-only, by the named adapter, through the server role.
  const staffVerify = await rpc(
    'verify_filing_receipt',
    {
      p_receipt_id: filed.body.receipt_id,
      p_found_digest: filed.body.claimed_digest,
      p_adapter_name: 'not-the-server',
    },
    intake.token,
  );
  check(
    staffVerify.status === 403 || staffVerify.status === 401,
    `${intake.email}: staff cannot verify a receipt; the interface is the server role's (${staffVerify.status})`,
  );
  const verified = await verify();
  check(
    verified.ok &&
      verified.results.length === 2 &&
      verified.results.every((entry) => !entry.replayed),
    `server role: ${SYNTHETIC_DRIVE_NAME} checks both recorded receipts`,
  );
  const after = await rest(
    `/filing_receipts?select=id,status,claimed_digest,found_digest,adapter_name&case_id=eq.${CASES.a1}`,
    intake.token,
  );
  const byId = new Map((after.body ?? []).map((row) => [row.id, row]));
  const first = byId.get(filed.body.receipt_id);
  const secondRow = second.status === 200 ? byId.get(second.body.receipt_id) : undefined;
  check(
    first?.status === 'VERIFIED' &&
      first.found_digest === first.claimed_digest &&
      first.adapter_name === SYNTHETIC_DRIVE_NAME,
    `${intake.email}: the receipt whose file holds the claimed bytes is VERIFIED, named to the adapter`,
  );
  check(
    secondRow?.status === 'MISMATCH' &&
      typeof secondRow.found_digest === 'string' &&
      secondRow.found_digest !== secondRow.claimed_digest,
    `${intake.email}: the receipt whose file holds other bytes is MISMATCH, with what was found`,
  );
  const verifiedAgain = await verify();
  check(
    verifiedAgain.ok && verifiedAgain.results.length === 0,
    'server role: a second verification pass finds nothing left to check',
  );

  // Nothing moved, and the client sees only the enumerated trail.
  const finalCase = await readCase(client.token);
  check(
    finalCase?.status === 'APPROVED' && finalCase.version === current.version,
    `${client.email}: filing moved nothing on the case (APPROVED, same version)`,
  );
  const trail = await rest(
    `/activity_events?select=id,event_kind&case_id=eq.${CASES.a1}&event_kind=in.(${SOURCE_EVENT_KINDS.join(',')})`,
    client.token,
  );
  const kinds = (trail.body ?? []).map((event) => event.event_kind);
  check(
    trail.status === 200 && SOURCE_EVENT_KINDS.every((kind) => kinds.includes(kind)),
    `${client.email}: the trail carries the source events as enumerated kinds (no text)`,
  );
  for (const event of trail.body ?? []) extraReach.activity_events.push(event.id);
}
