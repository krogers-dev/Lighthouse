/** The document path, end to end, through the shipped composition
 * (WO-003).
 *
 * The real AuthController, the real supabase-js bundle, and the real
 * DocumentsRepository against the live stack: the seeded documents read
 * with their true statuses; a synthetic PDF reserved, transferred into
 * the quarantine bucket, and confirmed into QUARANTINED; and the two
 * refusals a client can meet, a closed request and an unreserved path,
 * arriving as the typed errors the screens word. Runs only through the
 * bridge lanes; on the binary stack (no storage service) the transfer
 * journey is skipped by the lane's own report, never faked.
 */
import type { AuthState } from '@/auth/machine';
import { sha256Hex } from '@/core/sha256';
import { UploadRefusedError } from '@/data/supabase/documents';

import { buildApp, signInWithOtp, waitForState } from './journeys';

const CLIENT_EMAIL = 'client.owner@example.invalid';
const A1_ENTITY = 'aaaaaaaa-1111-4000-8000-000000000001';
const A1_OPEN_REQUEST = 'dddddddd-0000-4000-8000-0000000000a1';
const A1_ANSWERED_REQUEST = 'dddddddd-0000-4000-8000-0000000000a2';
const SEEDED_ACCEPTED = 'd0c0d0c0-0000-4000-8000-0000000000a1';
const SEEDED_REJECTED = 'd0c0d0c0-0000-4000-8000-0000000000a2';

/** A small, clearly synthetic PDF; unique per run so the reservation is
 * always fresh (the seed never places anything in quarantine). */
function syntheticPdf(): Uint8Array {
  const text = `%PDF-1.4\n% HIVE live-bridge synthetic document (Synthetic) ${Date.now()}\n%%EOF\n`;
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0x7f;
  return out;
}

function uuidV4(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

jest.setTimeout(120_000);

describe('live bridge: documents on a request through the shipped composition', () => {
  test('a client reads the seeded documents, sends one into quarantine, and meets both refusals as typed errors', async () => {
    const app = buildApp();
    await app.controller.boot();
    await waitForState(app.controller, 'boot', (state) => state.name === 'signed_out');
    await signInWithOtp(app, CLIENT_EMAIL);
    const chooser = (await waitForState(
      app.controller,
      'chooser',
      (state) => state.name === 'select_scope',
    )) as Extract<AuthState, { name: 'select_scope' }>;
    const a1 = chooser.memberships.find((membership) => membership.entityId === A1_ENTITY);
    if (!a1) throw new Error('canonical A1 membership missing from live chooser');
    await app.controller.selectScope(a1.membershipId);
    const authorized = (await waitForState(
      app.controller,
      'authorized',
      (state) => state.name === 'authorized',
    )) as Extract<AuthState, { name: 'authorized' }>;
    const scope = authorized.scope;

    // The seeded documents, with their true statuses, and nothing that
    // is not a document (no reservation rows).
    const before = await app.documents.list(scope, A1_OPEN_REQUEST);
    const seededIds = before.items.map((item) => item.id);
    expect(seededIds).toEqual(expect.arrayContaining([SEEDED_ACCEPTED, SEEDED_REJECTED]));
    expect(before.items.find((item) => item.id === SEEDED_ACCEPTED)?.status).toBe('ACCEPTED');
    expect(before.items.find((item) => item.id === SEEDED_REJECTED)?.status).toBe('REJECTED');
    for (const item of before.items) expect(item.displayName).toContain('(Synthetic)');
    expect(before.recordedThrough).not.toBeNull();

    const request = await app.requests.get(scope, A1_OPEN_REQUEST);
    if (!request) throw new Error('the open A1 request is missing');
    expect(request.status).toBe('OPEN');

    // Reserve, transfer, confirm: the bytes are the truth, the digest is
    // computed here exactly as the phone computes it.
    const bytes = syntheticPdf();
    const reservation = await app.documents.begin(scope, {
      requestId: request.id,
      requestVersion: request.version,
      idempotencyKey: uuidV4(),
      displayName: 'live-bridge (Synthetic).pdf',
      mimeType: 'application/pdf',
      byteSize: bytes.byteLength,
      clientDigest: sha256Hex(bytes),
    });
    expect(reservation.status).toBe('UPLOADING');
    expect(reservation.storageBucket).toBe('hive-quarantine');
    expect(reservation.storagePath.endsWith(`/${A1_OPEN_REQUEST}/${reservation.uploadId}`)).toBe(
      true,
    );

    // Not yet: the object is not there, and the server says exactly that.
    await expect(app.documents.complete(reservation.uploadId)).rejects.toMatchObject({
      refusal: 'transfer_incomplete',
    });

    await app.documents.transfer(reservation, bytes, 'application/pdf');
    const receipt = await app.documents.complete(reservation.uploadId);
    expect(receipt.status).toBe('QUARANTINED');
    expect(receipt.receivedAt).not.toBeNull();

    const after = await app.documents.list(scope, A1_OPEN_REQUEST);
    expect(after.items.length).toBe(before.items.length + 1);
    const received = after.items.find((item) => item.id === reservation.uploadId);
    expect(received).toMatchObject({
      status: 'QUARANTINED',
      displayName: 'live-bridge (Synthetic).pdf',
      byteSize: bytes.byteLength,
    });

    // A closed request refuses a document, as a typed refusal the screen
    // words, never as a generic error.
    const answered = await app.requests.get(scope, A1_ANSWERED_REQUEST);
    if (!answered) throw new Error('the answered A1 request is missing');
    await expect(
      app.documents.begin(scope, {
        requestId: answered.id,
        requestVersion: answered.version,
        idempotencyKey: uuidV4(),
        displayName: 'never-sent (Synthetic).pdf',
        mimeType: 'application/pdf',
        byteSize: bytes.byteLength,
        clientDigest: sha256Hex(bytes),
      }),
    ).rejects.toBeInstanceOf(UploadRefusedError);

    // An unreserved path is denied by the bucket policy: the storage
    // service answers with a denial, which arrives as the safe error.
    await expect(
      app.documents.transfer(
        {
          uploadId: reservation.uploadId,
          storageBucket: 'hive-quarantine',
          storagePath: `${reservation.storagePath}-not-reserved`,
          status: 'UPLOADING',
        },
        bytes,
        'application/pdf',
      ),
    ).rejects.toMatchObject({ code: 'denied' });

    await app.controller.signOut();
    await waitForState(app.controller, 'signed out', (state) => state.name === 'signed_out');
  });
});
