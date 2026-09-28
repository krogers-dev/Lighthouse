import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  DOCUMENT_COLUMNS,
  QUARANTINE_BUCKET,
  SYNTHETIC_DOCUMENTS,
  renderSeedSql,
  storagePathFor,
} from '../../scripts/lib/synthetic-documents.mjs';
import { SCOPE, SYNTHETIC_IDENTITIES } from '../../scripts/lib/synthetic-identities.mjs';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const ALLOWED_MIME = ['application/pdf', 'image/png', 'image/jpeg', 'text/csv'];
const MAX_BYTES = 20 * 1024 * 1024;
const canonicalUserIds = new Set(SYNTHETIC_IDENTITIES.map((identity) => identity.id));

test('the committed SQL mirror is exactly what the module renders (lockstep)', () => {
  const committed = readFileSync(
    path.join(appRoot, 'supabase', 'seeds', 'synthetic-documents.sql'),
    'utf8',
  );
  assert.equal(committed, renderSeedSql());
});

test('every seeded document is synthetic, settled, within limits, and canonically bound', () => {
  assert.ok(SYNTHETIC_DOCUMENTS.length >= 3);
  for (const document of SYNTHETIC_DOCUMENTS) {
    assert.match(document.display_name, /\(Synthetic\)/, `${document.id} is marked synthetic`);
    assert.match(document.client_digest, /^[0-9a-f]{64}$/, `${document.id} digest shape`);
    assert.ok(ALLOWED_MIME.includes(document.mime_type), `${document.id} mime allowlisted`);
    assert.ok(document.byte_size > 0 && document.byte_size <= MAX_BYTES, `${document.id} size`);
    assert.ok(['ACCEPTED', 'REJECTED'].includes(document.status), `${document.id} is settled`);
    assert.equal(
      document.rejection_reason !== null,
      document.status === 'REJECTED',
      `${document.id} carries a reason exactly when rejected`,
    );
    assert.ok(canonicalUserIds.has(document.created_by), `${document.id} created_by canonical`);
    assert.equal(document.storage_bucket, QUARANTINE_BUCKET);
    assert.equal(
      document.storage_path,
      storagePathFor({
        environmentId: document.environment_id,
        clientId: document.client_id,
        entityId: document.entity_id,
        requestId: document.request_id,
        uploadId: document.id,
      }),
      `${document.id} path is scope / request / id`,
    );
    assert.equal(document.environment_id, SCOPE.environmentId);
    assert.ok(document.received_at !== null && document.checked_at !== null);
  }
});

test('the rendered SQL names every column once, in the upsert order, and is idempotent', () => {
  const sql = renderSeedSql();
  assert.ok(
    sql.includes(`insert into public.document_uploads (${DOCUMENT_COLUMNS.join(', ')}) values`),
  );
  assert.ok(sql.trimEnd().endsWith('on conflict (id) do nothing;'));
  assert.equal(new Set(DOCUMENT_COLUMNS).size, DOCUMENT_COLUMNS.length);
  for (const document of SYNTHETIC_DOCUMENTS) {
    for (const column of DOCUMENT_COLUMNS) {
      assert.ok(column in document, `${document.id} has ${column}`);
    }
  }
  // Every scoped isolation negative needs a row outside client A's reach.
  assert.ok(SYNTHETIC_DOCUMENTS.some((document) => document.client_id === SCOPE.clientB));
});
