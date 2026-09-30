/** The answer path (WO-004) as real JWTs over PostgREST, for the
 * black-box harness (scripts/e2e-local-auth.mjs step 3c).
 *
 * The draft, every refusal a client can meet, the explicit submission,
 * its idempotency, exactly what it moves, and who can see what: another
 * client nothing, staff at AAL1 nothing, the audit trail no client. The
 * harness passes in its own helpers (`rest`, `rpc`, `check`, the
 * fixture ids, the extra-reach sets) so this module proves the server
 * through the same adapter the rest of the harness uses and never a
 * second one. The seeded question is reset first, through the checked
 * loopback reset, so a re-run on the same stack starts from the seed.
 */

const SEEDED_ANSWERED_AT = '2026-08-11T09:15:00Z';

export async function assertAnswerPath(ctx, parties) {
  const { rest, rpc, check, uuidV4, extraReach, SCOPE, REQUESTS, DOCUMENTS, CASES, reset } = ctx;
  const { owner, ownerSession, other, otherSession, staff, staffSession } = parties;

  const resetResult = await reset('a1Question');
  if (
    !check(
      resetResult.ok,
      `answer path: the seeded question starts OPEN with no answer (${
        resetResult.ok ? 'checked reset' : resetResult.problems.join('; ')
      })`,
    )
  ) {
    return;
  }

  const token = ownerSession.access_token;
  const before = await rest(
    `/requests?select=id,status,version,subject_document_id&id=eq.${REQUESTS.a3}`,
    token,
  );
  const request = before.body?.[0];
  if (
    !check(
      before.status === 200 && request?.status === 'OPEN',
      `${owner.email}: the November question is OPEN`,
    )
  ) {
    return;
  }
  check(
    request.subject_document_id === DOCUMENTS.a2Accepted,
    `${owner.email}: the question carries its source link to the checked November statement`,
  );
  const subject = await rest(
    `/document_uploads?select=id,request_id&id=eq.${request.subject_document_id}`,
    token,
  );
  check(
    subject.status === 200 && subject.body?.[0]?.request_id === REQUESTS.a2,
    `${owner.email}: the source document resolves inside the scope, on another request of the case`,
  );
  const caseBefore = await rest(`/cases?select=id,status&id=eq.${CASES.a1}`, token);

  const args = {
    p_environment_id: SCOPE.environmentId,
    p_client_id: SCOPE.clientA,
    p_entity_id: SCOPE.entityA1,
    p_request_id: REQUESTS.a3,
    p_request_version: request.version,
    p_body: 'Yes, the closing balance matches our records (Synthetic).',
    p_cited_document_ids: [DOCUMENTS.a3Accepted],
  };
  const draft = await rpc('save_request_answer_draft', args, token);
  if (
    !check(
      draft.status === 200 && draft.body?.status === 'DRAFT' && draft.body?.version === 1,
      `${owner.email}: save_request_answer_draft creates a draft at version 1`,
    )
  ) {
    return;
  }
  const answerId = draft.body.answer_id;
  extraReach.request_answers.push(answerId);

  const stale = await rpc('save_request_answer_draft', args, token);
  check(
    stale.status === 400 && stale.body?.message === 'answer_changed',
    `${owner.email}: saving as if no draft existed, when one does, is refused (answer_changed)`,
  );
  const foreignCite = await rpc(
    'save_request_answer_draft',
    { ...args, p_cited_document_ids: [DOCUMENTS.a1Accepted], p_answer_version: 1 },
    token,
  );
  check(
    foreignCite.status === 400 && foreignCite.body?.message === 'invalid_document',
    `${owner.email}: a document on another request cannot be cited (invalid_document)`,
  );
  const staffDraft = await rpc('save_request_answer_draft', args, staffSession.access_token);
  check(staffDraft.status === 403, `${staff.email}: staff cannot write a draft (403)`);

  const citations = await rest(
    `/request_answer_citations?select=id,document_id&answer_id=eq.${answerId}`,
    token,
  );
  check(
    citations.status === 200 &&
      citations.body?.length === 1 &&
      citations.body[0].document_id === DOCUMENTS.a3Accepted,
    `${owner.email}: the draft carries its one citation`,
  );

  const otherDraft = await rest(
    `/request_answers?select=id&id=eq.${answerId}`,
    otherSession.access_token,
  );
  check(
    otherDraft.status === 200 && (otherDraft.body ?? []).length === 0,
    `${other.email}: the draft is invisible to another client (zero rows)`,
  );
  const staffDraftRead = await rest(
    `/request_answers?select=id&id=eq.${answerId}`,
    staffSession.access_token,
  );
  check(
    staffDraftRead.status === 200 && (staffDraftRead.body ?? []).length === 0,
    `${staff.email}: staff at AAL1 see no draft (zero rows)`,
  );

  const blank = await rpc(
    'save_request_answer_draft',
    { ...args, p_body: '   ', p_answer_version: 1 },
    token,
  );
  check(
    blank.status === 200 && blank.body?.version === 2,
    `${owner.email}: a blank draft can be saved (version 2)`,
  );
  const blankSubmit = await rpc(
    'submit_request_answer',
    { p_answer_id: answerId, p_answer_version: 2, p_idempotency_key: uuidV4() },
    token,
  );
  check(
    blankSubmit.status === 400 && blankSubmit.body?.message === 'empty_answer',
    `${owner.email}: but not submitted (empty_answer)`,
  );
  const final = await rpc('save_request_answer_draft', { ...args, p_answer_version: 2 }, token);
  check(
    final.status === 200 && final.body?.version === 3,
    `${owner.email}: the final draft, citing the question's own checked document, is version 3`,
  );
  // Every save replaces the citation set, and with it the row ids: the
  // final draft's row is the one the AAL2 reach checks will see.
  const finalCitations = await rest(
    `/request_answer_citations?select=id&answer_id=eq.${answerId}`,
    token,
  );
  check(
    finalCitations.status === 200 && finalCitations.body?.length === 1,
    `${owner.email}: the final draft carries exactly one citation row`,
  );
  for (const row of finalCitations.body ?? []) extraReach.request_answer_citations.push(row.id);

  const key = uuidV4();
  const staleSubmit = await rpc(
    'submit_request_answer',
    { p_answer_id: answerId, p_answer_version: 1, p_idempotency_key: key },
    token,
  );
  check(
    staleSubmit.status === 400 && staleSubmit.body?.message === 'answer_changed',
    `${owner.email}: submitting a stale version is refused (answer_changed)`,
  );
  const foreignSubmit = await rpc(
    'submit_request_answer',
    { p_answer_id: answerId, p_answer_version: 3, p_idempotency_key: uuidV4() },
    otherSession.access_token,
  );
  check(
    foreignSubmit.status === 403,
    `${other.email}: cannot submit someone else's answer (403, indistinguishable from none)`,
  );
  const submitted = await rpc(
    'submit_request_answer',
    { p_answer_id: answerId, p_answer_version: 3, p_idempotency_key: key },
    token,
  );
  check(
    submitted.status === 200 &&
      submitted.body?.status === 'SUBMITTED' &&
      typeof submitted.body?.submitted_at === 'string',
    `${owner.email}: an explicit submission settles the answer, stamped with server time`,
  );
  const replay = await rpc(
    'submit_request_answer',
    { p_answer_id: answerId, p_answer_version: 3, p_idempotency_key: key },
    token,
  );
  check(
    replay.status === 200 && replay.body?.submitted_at === submitted.body?.submitted_at,
    `${owner.email}: the same submission key replays the same receipt`,
  );
  const again = await rpc(
    'submit_request_answer',
    { p_answer_id: answerId, p_answer_version: 4, p_idempotency_key: uuidV4() },
    token,
  );
  check(
    again.status === 400 && again.body?.message === 'already_submitted',
    `${owner.email}: a second submission is refused (already_submitted)`,
  );
  const afterDraft = await rpc(
    'save_request_answer_draft',
    { ...args, p_request_version: request.version + 1, p_answer_version: 4 },
    token,
  );
  check(
    afterDraft.status === 400 && afterDraft.body?.message === 'already_submitted',
    `${owner.email}: a submitted answer takes no more drafts (already_submitted)`,
  );

  const after = await rest(`/requests?select=id,status,version&id=eq.${REQUESTS.a3}`, token);
  check(
    after.status === 200 &&
      after.body?.[0]?.status === 'ANSWERED' &&
      after.body?.[0]?.version === request.version + 1,
    `${owner.email}: the request moved to ANSWERED and its version moved with it`,
  );
  const caseAfter = await rest(`/cases?select=id,status&id=eq.${CASES.a1}`, token);
  check(
    caseBefore.status === 200 &&
      caseAfter.status === 200 &&
      caseAfter.body?.[0]?.status === caseBefore.body?.[0]?.status,
    `${owner.email}: the case status did not move (${caseAfter.body?.[0]?.status})`,
  );
  const trail = await rest(
    `/activity_events?select=id,event_kind,actor_role&case_id=eq.${CASES.a1}&event_kind=eq.request.answered&occurred_at=gt.${encodeURIComponent(SEEDED_ANSWERED_AT)}`,
    token,
  );
  check(
    trail.status === 200 &&
      (trail.body ?? []).length === 1 &&
      trail.body[0].actor_role === 'client_user',
    `${owner.email}: the trail gained one "request answered" by the client (no free text)`,
  );
  for (const event of trail.body ?? []) extraReach.activity_events.push(event.id);

  const audit = await rest('/audit_receipts?select=id&limit=1', token);
  check(
    audit.status >= 400,
    `${owner.email}: audit receipts are not readable by a client (${audit.status})`,
  );
  const otherFinal = await rest(
    `/request_answers?select=id&id=eq.${answerId}`,
    otherSession.access_token,
  );
  check(
    otherFinal.status === 200 && (otherFinal.body ?? []).length === 0,
    `${other.email}: the submitted answer is invisible to another client (zero rows)`,
  );
}
