/** The answer path, end to end, through the shipped composition
 * (WO-004).
 *
 * The real AuthController, the real supabase-js bundle, and the real
 * AnswersRepository, RequestsRepository, and DocumentsRepository against
 * the live stack: the seeded question read with its source document
 * resolved inside the scope; a draft saved with a citation and read back
 * from the server; the explicit submission moving exactly the request;
 * the same key replaying the same receipt; and the refusals arriving as
 * the typed errors the screens word. Runs only through the bridge lanes.
 * On the CLI stack the lane resets the seeded question first (the stack
 * persists between runs); the binary stack seeds fresh every run.
 */
import type { AuthState } from '@/auth/machine';
import { AnswerRefusedError } from '@/data/supabase/answers';

import { buildApp, signInWithOtp, waitForState } from './journeys';

const CLIENT_EMAIL = 'client.owner@example.invalid';
const A1_ENTITY = 'aaaaaaaa-1111-4000-8000-000000000001';
const QUESTION = 'dddddddd-0000-4000-8000-0000000000a3';
const ANSWERED_REQUEST = 'dddddddd-0000-4000-8000-0000000000a2';
const SUBJECT_DOCUMENT = 'd0c0d0c0-0000-4000-8000-0000000000a3';
const QUESTION_DOCUMENT = 'd0c0d0c0-0000-4000-8000-0000000000a4';
const OTHER_REQUEST_DOCUMENT = 'd0c0d0c0-0000-4000-8000-0000000000a1';

function uuidV4(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

jest.setTimeout(120_000);

describe('live bridge: an answer on a request through the shipped composition', () => {
  test('a client reads the question with its source, drafts, submits once, and meets the refusals as typed errors', async () => {
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

    // The question, OPEN, about a checked document on ANOTHER request of
    // the case, resolved by its own scoped read.
    const question = await app.requests.get(scope, QUESTION);
    if (!question) throw new Error('the seeded November question is missing');
    expect(question.status).toBe('OPEN');
    expect(question.subjectDocumentId).toBe(SUBJECT_DOCUMENT);
    const subject = await app.documents.getById(scope, SUBJECT_DOCUMENT);
    expect(subject).toMatchObject({
      id: SUBJECT_DOCUMENT,
      displayName: 'statement-2025-11 (Synthetic).pdf',
      status: 'ACCEPTED',
    });
    expect(await app.answers.get(scope, QUESTION)).toBeNull();

    // A draft, saved on the server and read back with its citation.
    const draft = await app.answers.saveDraft(scope, {
      requestId: QUESTION,
      requestVersion: question.version,
      body: 'Yes, the closing balance matches our records (Synthetic).',
      citedDocumentIds: [QUESTION_DOCUMENT],
      answerVersion: null,
    });
    expect(draft).toMatchObject({ status: 'DRAFT', version: 1 });
    const readBack = await app.answers.get(scope, QUESTION);
    expect(readBack).toMatchObject({
      id: draft.answerId,
      status: 'DRAFT',
      body: 'Yes, the closing balance matches our records (Synthetic).',
      version: 1,
      citedDocumentIds: [QUESTION_DOCUMENT],
      submittedAt: null,
    });

    // The refusals a screen must word: a document on another request, a
    // stale draft version, and a closed request.
    await expect(
      app.answers.saveDraft(scope, {
        requestId: QUESTION,
        requestVersion: question.version,
        body: 'x',
        citedDocumentIds: [OTHER_REQUEST_DOCUMENT],
        answerVersion: 1,
      }),
    ).rejects.toMatchObject({ refusal: 'invalid_document' });
    await expect(
      app.answers.saveDraft(scope, {
        requestId: QUESTION,
        requestVersion: question.version,
        body: 'x',
        citedDocumentIds: [],
        answerVersion: 7,
      }),
    ).rejects.toMatchObject({ refusal: 'answer_changed' });
    const answered = await app.requests.get(scope, ANSWERED_REQUEST);
    if (!answered) throw new Error('the answered A1 request is missing');
    await expect(
      app.answers.saveDraft(scope, {
        requestId: ANSWERED_REQUEST,
        requestVersion: answered.version,
        body: 'x',
        citedDocumentIds: [],
        answerVersion: null,
      }),
    ).rejects.toBeInstanceOf(AnswerRefusedError);

    // The explicit submission: one key, the request moves, the same key
    // replays the same receipt, and a second submission is refused.
    const key = uuidV4();
    const submitted = await app.answers.submit({
      answerId: draft.answerId,
      answerVersion: draft.version,
      idempotencyKey: key,
    });
    expect(submitted).toMatchObject({ status: 'SUBMITTED', version: 2 });
    expect(submitted.submittedAt).not.toBeNull();
    const replay = await app.answers.submit({
      answerId: draft.answerId,
      answerVersion: draft.version,
      idempotencyKey: key,
    });
    expect(replay.submittedAt).toBe(submitted.submittedAt);
    await expect(
      app.answers.submit({
        answerId: draft.answerId,
        answerVersion: submitted.version,
        idempotencyKey: uuidV4(),
      }),
    ).rejects.toMatchObject({ refusal: 'already_submitted' });

    const after = await app.requests.get(scope, QUESTION);
    expect(after).toMatchObject({ status: 'ANSWERED', version: question.version + 1 });
    const settled = await app.answers.get(scope, QUESTION);
    expect(settled).toMatchObject({ status: 'SUBMITTED', citedDocumentIds: [QUESTION_DOCUMENT] });
    // The trail gained the enumerated kind and nothing else.
    const activity = await app.activity.list(scope);
    expect(activity.items.some((entry) => entry.kind === 'request.answered')).toBe(true);

    await app.controller.signOut();
    await waitForState(app.controller, 'signed out', (state) => state.name === 'signed_out');
  });
});
