/** Canonical synthetic DOCUMENT rows for the seeded requests (WO-003).
 *
 * The Milestone 2 read surface (the documents on a request) needs rows to
 * show, and the isolation assertions need rows OUTSIDE the seeded client
 * user's reach so every negative is real (the RETURN-4 P2-4 lesson). The
 * rows reference auth users, so they cannot live in supabase/seed.sql:
 * on the full Supabase lane the users are created afterwards by
 * scripts/seed-local.mjs through the Auth Admin API, which then upserts
 * these rows; the SQL-only pgTAP lane applies the rendered mirror
 * (supabase/seeds/synthetic-documents.sql) after its placeholder
 * identities. renderSeedSql() below IS that mirror — the committed file
 * is its output, and tests/scripts/synthetic-documents.test.mjs fails
 * when the two drift.
 *
 * Everything here is fictional: "(Synthetic)" names, digests derived from
 * the name rather than from any real file, no object in any bucket. A
 * seeded row is an evidence REFERENCE that already reached a terminal
 * state; nothing seeded is ever in quarantine, so the local scan tooling
 * never touches a seed row.
 */
import { SCOPE, SYNTHETIC_IDENTITIES } from './synthetic-identities.mjs';

const CLIENT_OWNER = SYNTHETIC_IDENTITIES.find(
  (identity) => identity.email === 'client.owner@example.invalid',
).id;
const CLIENT_SECOND = SYNTHETIC_IDENTITIES.find(
  (identity) => identity.email === 'client.second@example.invalid',
).id;

export const REQUESTS = {
  a1Open: 'dddddddd-0000-4000-8000-0000000000a1',
  a1Answered: 'dddddddd-0000-4000-8000-0000000000a2',
  /** Milestone 3: the open question about the November statement. */
  a1Question: 'dddddddd-0000-4000-8000-0000000000a3',
  b1Open: 'dddddddd-0000-4000-8000-0000000000b1',
};

/** The source links (WO-004): which document a seeded question is about.
 * Seeded only: no client or staff path sets one in Milestone 3. The
 * November question points at the checked statement that sits on the
 * ANSWERED request of the same case, so "resolved inside the scope, even
 * from another request" is a real property of the seed. Applied after the
 * documents exist, by both seed lanes. */
export const SUBJECT_LINKS = [
  { requestId: REQUESTS.a1Question, documentId: 'd0c0d0c0-0000-4000-8000-0000000000a3' },
];

export const CASES = {
  a1: 'eeeeeeee-0000-4000-8000-0000000000a1',
  b1: 'eeeeeeee-0000-4000-8000-0000000000b1',
};

export const QUARANTINE_BUCKET = 'hive-quarantine';

/** The reserved object path for one upload: scope, request, upload id,
 * exactly as public.begin_document_upload writes it. */
export function storagePathFor({ environmentId, clientId, entityId, requestId, uploadId }) {
  return `${environmentId}/${clientId}/${entityId}/${requestId}/${uploadId}`;
}

function row({
  id,
  clientKey,
  entityKey,
  caseId,
  requestId,
  createdBy,
  status,
  displayName,
  mimeType,
  byteSize,
  clientDigest,
  createdAt,
  checkedAt,
  rejectionReason = null,
}) {
  const environmentId = SCOPE.environmentId;
  const clientId = SCOPE[clientKey];
  const entityId = SCOPE[entityKey];
  const receivedAt = createdAt;
  const expiresAt = new Date(new Date(receivedAt).getTime() + 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .replace('.000Z', 'Z');
  return {
    id,
    environment_id: environmentId,
    client_id: clientId,
    entity_id: entityId,
    case_id: caseId,
    request_id: requestId,
    created_by: createdBy,
    idempotency_key: id.replace('-0000-', '-1111-'),
    status,
    display_name: displayName,
    mime_type: mimeType,
    byte_size: byteSize,
    client_digest: clientDigest,
    storage_bucket: QUARANTINE_BUCKET,
    storage_path: storagePathFor({ environmentId, clientId, entityId, requestId, uploadId: id }),
    version: 3,
    received_at: receivedAt,
    checked_at: checkedAt,
    expires_at: expiresAt,
    rejection_reason: rejectionReason,
    created_at: createdAt,
    updated_at: checkedAt,
  };
}

/** Digests are sha256("HIVE synthetic seed document: <name>") — derived
 * from the fictional name so they are reproducible and obviously not the
 * digest of any real file. */
export const SYNTHETIC_DOCUMENTS = [
  // A1, the open request: one checked document and one not accepted, so
  // the request shows both settled outcomes before any device run.
  row({
    id: 'd0c0d0c0-0000-4000-8000-0000000000a1',
    clientKey: 'clientA',
    entityKey: 'entityA1',
    caseId: CASES.a1,
    requestId: REQUESTS.a1Open,
    createdBy: CLIENT_OWNER,
    status: 'ACCEPTED',
    displayName: 'bank-statement-2026-07 (Synthetic).pdf',
    mimeType: 'application/pdf',
    byteSize: 184320,
    clientDigest: '1bbf55cd57909a8de8bec3dc03dad2312772e489c52f83bcbddc364467bfaafa',
    createdAt: '2026-08-11T10:00:00Z',
    checkedAt: '2026-08-11T10:05:00Z',
  }),
  row({
    id: 'd0c0d0c0-0000-4000-8000-0000000000a2',
    clientKey: 'clientA',
    entityKey: 'entityA1',
    caseId: CASES.a1,
    requestId: REQUESTS.a1Open,
    createdBy: CLIENT_OWNER,
    status: 'REJECTED',
    displayName: 'receipt-photo (Synthetic).jpeg',
    mimeType: 'image/jpeg',
    byteSize: 2411520,
    clientDigest: 'e92f2485bd6af03a485b2f3d6f6bd74dfb30a156abd47ae302d951bac04b326b',
    createdAt: '2026-08-12T09:30:00Z',
    checkedAt: '2026-08-12T09:34:00Z',
    rejectionReason: 'unsupported_content',
  }),
  // A1, the answered request: the document its answer will cite in
  // Milestone 3, checked and settled.
  row({
    id: 'd0c0d0c0-0000-4000-8000-0000000000a3',
    clientKey: 'clientA',
    entityKey: 'entityA1',
    caseId: CASES.a1,
    requestId: REQUESTS.a1Answered,
    createdBy: CLIENT_OWNER,
    status: 'ACCEPTED',
    displayName: 'statement-2025-11 (Synthetic).pdf',
    mimeType: 'application/pdf',
    byteSize: 96256,
    clientDigest: 'bf380c3107ec374fd0cf602388bb57dfe43c7033a810c64a24609dbe38c766a5',
    createdAt: '2026-08-06T14:00:00Z',
    checkedAt: '2026-08-06T14:03:00Z',
  }),
  // A1, the November question (Milestone 3): one checked document of its
  // own, so an answer on it has something to cite in every lane.
  row({
    id: 'd0c0d0c0-0000-4000-8000-0000000000a4',
    clientKey: 'clientA',
    entityKey: 'entityA1',
    caseId: CASES.a1,
    requestId: REQUESTS.a1Question,
    createdBy: CLIENT_OWNER,
    status: 'ACCEPTED',
    displayName: 'november-balance-photo (Synthetic).png',
    mimeType: 'image/png',
    byteSize: 512000,
    clientDigest: '7a1c2f3e4d5b6a7980f1e2d3c4b5a69788796a5b4c3d2e1f0a9b8c7d6e5f4a3b',
    createdAt: '2026-08-16T09:00:00Z',
    checkedAt: '2026-08-16T09:04:00Z',
  }),
  // Out of scope: client B / entity B1. Reachable by no seeded A user and
  // by staff only at AAL2, so the cross-scope negatives are real.
  row({
    id: 'd0c0d0c0-0000-4000-8000-0000000000b1',
    clientKey: 'clientB',
    entityKey: 'entityB1',
    caseId: CASES.b1,
    requestId: REQUESTS.b1Open,
    createdBy: CLIENT_SECOND,
    status: 'ACCEPTED',
    displayName: 'quarterly-packet (Synthetic).csv',
    mimeType: 'text/csv',
    byteSize: 40960,
    clientDigest: 'e3ff037304883f1d29020e4164c01dc53f1d926476a29d01acd95c49636f7609',
    createdAt: '2026-08-13T11:00:00Z',
    checkedAt: '2026-08-13T11:02:00Z',
  }),
];

/** Column order of the rendered INSERT and of the PostgREST upsert. */
export const DOCUMENT_COLUMNS = [
  'id',
  'environment_id',
  'client_id',
  'entity_id',
  'case_id',
  'request_id',
  'created_by',
  'idempotency_key',
  'status',
  'display_name',
  'mime_type',
  'byte_size',
  'client_digest',
  'storage_bucket',
  'storage_path',
  'version',
  'received_at',
  'checked_at',
  'expires_at',
  'rejection_reason',
  'created_at',
  'updated_at',
];

function sqlLiteral(value) {
  if (value === null) return 'null';
  if (typeof value === 'number') return String(value);
  return `'${String(value).replace(/'/g, "''")}'`;
}

/** The SQL mirror for the plain-PostgreSQL lane, rendered from the rows
 * above so it cannot drift from them. Idempotent on the primary key. */
export function renderSeedSql() {
  const lines = [
    '-- GENERATED from scripts/lib/synthetic-documents.mjs (renderSeedSql).',
    '-- Do not edit by hand: tests/scripts/synthetic-documents.test.mjs fails on drift.',
    '--',
    '-- Synthetic document rows for the SQL-only pgTAP lane (scripts/db-local.mjs),',
    '-- applied after supabase/seeds/pgtap-identities.sql because the rows reference',
    '-- auth users. The full Supabase lane inserts the same rows through',
    '-- scripts/seed-local.mjs. Fictional names, name-derived digests, no objects.',
    '',
    `insert into public.document_uploads (${DOCUMENT_COLUMNS.join(', ')}) values`,
  ];
  SYNTHETIC_DOCUMENTS.forEach((document, index) => {
    const values = DOCUMENT_COLUMNS.map((column) => sqlLiteral(document[column]));
    const suffix = index === SYNTHETIC_DOCUMENTS.length - 1 ? '' : ',';
    lines.push(`  (${values.join(', ')})${suffix}`);
  });
  lines.push('on conflict (id) do nothing;');
  lines.push('');
  lines.push('-- Source links (WO-004): the document a seeded question is about.');
  for (const link of SUBJECT_LINKS) {
    lines.push(
      `update public.requests set subject_document_id = ${sqlLiteral(link.documentId)}` +
        ` where id = ${sqlLiteral(link.requestId)} and subject_document_id is null;`,
    );
  }
  lines.push('');
  return lines.join('\n');
}
