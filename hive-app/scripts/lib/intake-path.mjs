/** Intake (WO-013) as real requests, for the black-box harness: the
 * in-app authoring of cases and requests, on the entity the seed leaves
 * empty (A2, Harbor Light Holdings), so nothing here disturbs the exact
 * reach sets the other steps assert on A1 and B1 — and so the identities
 * whose reach IS asserted afterwards (preparer.pat, mixed.cross,
 * mixed.same) prove, by seeing none of these rows, that authoring stays
 * inside its scope.
 *
 * What it proves: only intake of the scope, at AAL2, opens a case; the
 * title is cleaned and bounded; a creation replays by key without a
 * second row; the client sees the draft (as "Being set up") and nothing
 * can be asked on it; recording the intake is version-checked, replays,
 * writes the one trail entry, and cannot happen twice; a request is
 * validated (title, detail, due window, subject must be a checked
 * document of THIS case), the first one moves the case to waiting on
 * documents and the next leaves it there; the client of the scope reads
 * the requests and nobody else does; closing is version-checked, replays,
 * cannot repeat, and moves nothing on the case; an empty draft can be
 * discarded and a recorded case cannot; the draft bound holds; and every
 * receipt carries ids and facts only — never the title or the detail.
 */

const OPEN_LIMIT = 20;

export async function assertIntakePath(ctx, parties) {
  const { rest, rpc, check, uuidV4, url, serviceKey, gatewayKey, SCOPE, DOCUMENTS } = ctx;
  const { intake, intakeAal1, preparer, client, other } = parties;

  const scopeArgs = {
    p_environment_id: SCOPE.environmentId,
    p_client_id: SCOPE.clientA,
    p_entity_id: SCOPE.entityA2,
  };
  const asServer = async (pathname) => {
    const response = await fetch(`${url}${pathname}`, {
      headers: { apikey: gatewayKey, Authorization: `Bearer ${serviceKey}` },
    });
    return { status: response.status, body: await response.json().catch(() => null) };
  };
  const refused = (result, token) => result.status === 400 && result.body?.message === token;
  const forbidden = (result) => result.status === 403 || result.status === 401;

  const tag = uuidV4().slice(0, 8);
  const title = `Harness intake ${tag} (Synthetic)`;
  const requestTitle = `Bank statement ${tag} (Synthetic)`;
  const requestDetail = `Every page of the July statement (${tag}, Synthetic).`;

  const openCase = (token, extra = {}) =>
    rpc(
      'open_case',
      { ...scopeArgs, p_title: title, p_idempotency_key: uuidV4(), ...extra },
      token,
    );

  // ---- who may open a case ----
  check(
    forbidden(await openCase(intakeAal1.token)),
    `${intakeAal1.email}: staff at AAL1 cannot open a case (403)`,
  );
  check(
    forbidden(await openCase(client.token)),
    `${client.email}: a client cannot open a case (403)`,
  );
  check(
    forbidden(await openCase(preparer.token)),
    `${preparer.email}: staff of other entities cannot open a case in A2 (403)`,
  );
  check(
    forbidden(
      await rpc(
        'open_case',
        { ...scopeArgs, p_entity_id: SCOPE.entityA1, p_title: title, p_idempotency_key: uuidV4() },
        preparer.token,
      ),
    ),
    `${preparer.email}: the preparer role does not open cases even where it is staff (403)`,
  );

  // ---- the title ----
  check(
    refused(await openCase(intake.token, { p_title: '   ' }), 'invalid_title'),
    `${intake.email}: an empty title is refused (invalid_title)`,
  );
  check(
    refused(await openCase(intake.token, { p_title: 'x'.repeat(121) }), 'invalid_title'),
    `${intake.email}: a 121-character title is refused (invalid_title)`,
  );
  check(
    refused(await openCase(intake.token, { p_title: `tab\there ${tag}` }), 'invalid_title'),
    `${intake.email}: a control character in the title is refused (invalid_title)`,
  );
  check(
    refused(await openCase(intake.token, { p_idempotency_key: null }), 'invalid_idempotency_key'),
    `${intake.email}: a creation without a key is refused (invalid_idempotency_key)`,
  );

  // ---- open, and replay ----
  const openKey = uuidV4();
  const opened = await openCase(intake.token, {
    p_title: `  Harness   intake ${tag}  (Synthetic) `,
    p_idempotency_key: openKey,
  });
  const caseId = opened.body?.case_id;
  if (
    !check(
      opened.status === 200 &&
        typeof caseId === 'string' &&
        opened.body.case_status === 'DRAFT' &&
        opened.body.case_version === 1,
      `${intake.email}: opens a case in A2 (DRAFT, version 1)`,
    )
  ) {
    return;
  }
  const replayed = await openCase(intake.token, { p_idempotency_key: openKey });
  check(
    replayed.status === 200 && replayed.body?.case_id === caseId,
    `${intake.email}: the same key replays the same case, not a second one`,
  );
  const named = await asServer(
    `/rest/v1/cases?select=id,title&title=eq.${encodeURIComponent(title)}`,
  );
  check(
    named.status === 200 && (named.body ?? []).length === 1 && named.body[0].id === caseId,
    `server: exactly one case carries the cleaned title (spaces collapsed, ends trimmed)`,
  );

  // ---- the draft as others see it ----
  const readCase = async (token) => {
    const row = await rest(`/cases?select=id,status,version,title&id=eq.${caseId}`, token);
    return row.status === 200 && Array.isArray(row.body) && row.body.length === 1
      ? row.body[0]
      : null;
  };
  const clientDraft = await readCase(client.token);
  check(
    clientDraft?.status === 'DRAFT' && clientDraft.version === 1 && clientDraft.title === title,
    `${client.email}: sees the draft in their workspace (DRAFT, shown as "Being set up")`,
  );
  check(
    (await readCase(other.token)) === null,
    `${other.email}: a client of another scope sees no such case`,
  );
  check(
    (await readCase(preparer.token)) === null,
    `${preparer.email}: staff of other entities see no such case`,
  );

  const transition = (name, token, args) => rpc(name, { ...scopeArgs, ...args }, token);
  const caseArgs = (version, extra = {}) => ({
    p_case_id: caseId,
    p_case_version: version,
    p_idempotency_key: uuidV4(),
    ...extra,
  });
  const requestArgs = (version, extra = {}) =>
    caseArgs(version, {
      p_title: requestTitle,
      p_detail: requestDetail,
      p_due_in_days: 14,
      p_subject_document_id: null,
      ...extra,
    });

  check(
    refused(
      await transition('open_request', intake.token, requestArgs(1)),
      'case_not_open_for_requests',
    ),
    `${intake.email}: nothing can be asked on a draft (case_not_open_for_requests)`,
  );

  // ---- record the intake ----
  check(
    refused(await transition('record_case_intake', intake.token, caseArgs(2)), 'case_changed'),
    `${intake.email}: recording against the wrong version is refused (case_changed)`,
  );
  check(
    forbidden(await transition('record_case_intake', client.token, caseArgs(1))),
    `${client.email}: a client cannot record the intake (403)`,
  );
  const recordKey = uuidV4();
  const recorded = await transition(
    'record_case_intake',
    intake.token,
    caseArgs(1, { p_idempotency_key: recordKey }),
  );
  check(
    recorded.status === 200 &&
      recorded.body?.case_status === 'INTAKE_RECORDED' &&
      recorded.body.case_version === 2,
    `${intake.email}: records the intake (INTAKE_RECORDED, version 2)`,
  );
  const recordedAgain = await transition(
    'record_case_intake',
    intake.token,
    caseArgs(1, { p_idempotency_key: recordKey }),
  );
  check(
    recordedAgain.status === 200 && recordedAgain.body?.case_version === 2,
    `${intake.email}: the same key replays the recorded result`,
  );
  check(
    refused(await transition('record_case_intake', intake.token, caseArgs(2)), 'case_not_draft'),
    `${intake.email}: the intake cannot be recorded twice (case_not_draft)`,
  );
  check(
    refused(await transition('discard_case_draft', intake.token, caseArgs(2)), 'case_not_draft'),
    `${intake.email}: a recorded case cannot be discarded (case_not_draft)`,
  );
  const received = await readCase(client.token);
  check(
    received?.status === 'INTAKE_RECORDED' && received.version === 2,
    `${client.email}: sees the case as received (INTAKE_RECORDED, version 2)`,
  );

  // ---- a request: validations ----
  const rejects = [
    ['invalid_title', { p_title: ' ' }, 'an empty request title'],
    ['invalid_title', { p_title: 'x'.repeat(121) }, 'a 121-character request title'],
    ['invalid_detail', { p_detail: 'x'.repeat(2001) }, 'a 2,001-character detail'],
    ['invalid_detail', { p_detail: 'bad\u0007bell' }, 'a control character in the detail'],
    ['invalid_due', { p_due_in_days: 0 }, 'a due date of today'],
    ['invalid_due', { p_due_in_days: 366 }, 'a due date beyond a year'],
    [
      'document_not_checked',
      { p_subject_document_id: DOCUMENTS.a1Accepted },
      'a subject document that is checked on ANOTHER case',
    ],
    [
      'document_not_checked',
      { p_subject_document_id: uuidV4() },
      'a subject document that does not exist',
    ],
    ['case_changed', { p_case_version: 1 }, 'a request against the wrong case version'],
  ];
  for (const [token, extra, what] of rejects) {
    check(
      refused(await transition('open_request', intake.token, requestArgs(2, extra)), token),
      `${intake.email}: ${what} is refused (${token})`,
    );
  }
  check(
    forbidden(await transition('open_request', client.token, requestArgs(2))),
    `${client.email}: a client cannot open a request (403)`,
  );
  check(
    forbidden(await transition('open_request', preparer.token, requestArgs(2))),
    `${preparer.email}: staff of other entities cannot open a request in A2 (403)`,
  );
  check(
    forbidden(await transition('open_request', intakeAal1.token, requestArgs(2))),
    `${intakeAal1.email}: staff at AAL1 cannot open a request (403)`,
  );

  // ---- the first request moves the case; the second leaves it ----
  const firstKey = uuidV4();
  const first = await transition(
    'open_request',
    intake.token,
    requestArgs(2, { p_idempotency_key: firstKey }),
  );
  const firstId = first.body?.request_id;
  if (
    !check(
      first.status === 200 &&
        typeof firstId === 'string' &&
        first.body.request_version === 1 &&
        first.body.case_status === 'EVIDENCE_PENDING' &&
        first.body.case_version === 3,
      `${intake.email}: the first request opens and moves the case (EVIDENCE_PENDING, version 3)`,
    )
  ) {
    return;
  }
  const firstAgain = await transition(
    'open_request',
    intake.token,
    requestArgs(2, { p_idempotency_key: firstKey }),
  );
  check(
    firstAgain.status === 200 && firstAgain.body?.request_id === firstId,
    `${intake.email}: the same key replays the same request, not a second one`,
  );
  const second = await transition(
    'open_request',
    intake.token,
    requestArgs(3, {
      p_title: `Payroll question ${tag} (Synthetic)`,
      p_detail: '',
      p_due_in_days: null,
    }),
  );
  const secondId = second.body?.request_id;
  check(
    second.status === 200 &&
      typeof secondId === 'string' &&
      second.body.case_status === 'EVIDENCE_PENDING' &&
      second.body.case_version === 3,
    `${intake.email}: a further request leaves the case where it is (EVIDENCE_PENDING, version 3)`,
  );

  // ---- the requests as others see them ----
  const requestColumns = 'id,case_id,title,detail,owner_role,status,version,requested_on,due_on';
  const clientRequests = await rest(
    `/requests?select=${requestColumns}&case_id=eq.${caseId}&order=requested_on.asc`,
    client.token,
  );
  const rows = clientRequests.body ?? [];
  const firstRow = rows.find((row) => row.id === firstId);
  const secondRow = rows.find((row) => row.id === secondId);
  const daysBetween = (from, to) =>
    Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
  check(
    clientRequests.status === 200 &&
      rows.length === 2 &&
      firstRow?.status === 'OPEN' &&
      firstRow.owner_role === 'client_user' &&
      firstRow.title === requestTitle &&
      firstRow.detail === requestDetail &&
      firstRow.version === 1 &&
      daysBetween(firstRow.requested_on, firstRow.due_on) === 14 &&
      secondRow?.status === 'OPEN' &&
      secondRow.due_on === null &&
      secondRow.detail === '',
    `${client.email}: reads exactly the two requests, owned by the client, one due in 14 days and one with no due date`,
  );
  for (const party of [other, preparer]) {
    const none = await rest(`/requests?select=id&case_id=eq.${caseId}`, party.token);
    check(
      none.status === 200 && (none.body ?? []).length === 0,
      `${party.email}: reads no request of the A2 case`,
    );
  }

  // ---- closing ----
  const closeArgs = (requestId, version, extra = {}) => ({
    p_request_id: requestId,
    p_request_version: version,
    p_idempotency_key: uuidV4(),
    ...extra,
  });
  check(
    forbidden(await transition('close_request', client.token, closeArgs(firstId, 1))),
    `${client.email}: a client cannot close a request (403)`,
  );
  check(
    forbidden(await transition('close_request', preparer.token, closeArgs(firstId, 1))),
    `${preparer.email}: staff of other entities cannot close a request in A2 (403)`,
  );
  check(
    refused(
      await transition('close_request', intake.token, closeArgs(firstId, 2)),
      'request_changed',
    ),
    `${intake.email}: closing against the wrong request version is refused (request_changed)`,
  );
  check(
    refused(
      await transition('close_request', intake.token, closeArgs(uuidV4(), 1)),
      'request_not_found',
    ),
    `${intake.email}: closing a request that is not in the scope is refused (request_not_found)`,
  );
  const closeKey = uuidV4();
  const closed = await transition(
    'close_request',
    intake.token,
    closeArgs(firstId, 1, { p_idempotency_key: closeKey }),
  );
  check(
    closed.status === 200 &&
      closed.body?.request_status === 'CLOSED' &&
      closed.body.request_version === 2,
    `${intake.email}: closes the first request (CLOSED, version 2)`,
  );
  const closedAgain = await transition(
    'close_request',
    intake.token,
    closeArgs(firstId, 1, { p_idempotency_key: closeKey }),
  );
  check(
    closedAgain.status === 200 && closedAgain.body?.request_version === 2,
    `${intake.email}: the same key replays the closed result`,
  );
  check(
    refused(
      await transition('close_request', intake.token, closeArgs(firstId, 2)),
      'request_not_closable',
    ),
    `${intake.email}: a closed request cannot be closed again (request_not_closable)`,
  );
  const afterClose = await rest(
    `/requests?select=id,status,version&id=eq.${firstId}`,
    client.token,
  );
  check(
    afterClose.status === 200 &&
      afterClose.body?.[0]?.status === 'CLOSED' &&
      afterClose.body[0].version === 2,
    `${client.email}: sees the request closed (version 2)`,
  );
  const afterCloseCase = await readCase(client.token);
  check(
    afterCloseCase?.status === 'EVIDENCE_PENDING' && afterCloseCase.version === 3,
    `${client.email}: closing moved nothing on the case (EVIDENCE_PENDING, version 3)`,
  );

  // ---- the trail: enumerated kinds, in order, no text ----
  const trail = await rest(
    `/activity_events?select=id,event_kind,actor_role&case_id=eq.${caseId}&order=occurred_at.asc,event_kind.asc`,
    client.token,
  );
  const kinds = (trail.body ?? []).map((event) => `${event.event_kind}:${event.actor_role}`);
  check(
    trail.status === 200 &&
      JSON.stringify(kinds) ===
        JSON.stringify([
          'case.intake_recorded:intake',
          'request.opened:intake',
          'request.opened:intake',
          'request.closed:intake',
        ]),
    `${client.email}: the trail is exactly intake recorded, two requests opened, one closed — by intake`,
  );
  const otherTrail = await rest(`/activity_events?select=id&case_id=eq.${caseId}`, other.token);
  check(
    otherTrail.status === 200 && (otherTrail.body ?? []).length === 0,
    `${other.email}: reads none of the A2 case's trail`,
  );

  // ---- a draft that holds nothing can be discarded; the bound holds ----
  const draftKey = uuidV4();
  const draft = await openCase(intake.token, {
    p_title: `Harness draft ${tag} (Synthetic)`,
    p_idempotency_key: draftKey,
  });
  const draftId = draft.body?.case_id;
  if (
    check(
      draft.status === 200 && typeof draftId === 'string',
      `${intake.email}: opens a second draft`,
    )
  ) {
    check(
      refused(
        await transition('discard_case_draft', intake.token, {
          p_case_id: draftId,
          p_case_version: 2,
          p_idempotency_key: uuidV4(),
        }),
        'case_changed',
      ),
      `${intake.email}: discarding against the wrong version is refused (case_changed)`,
    );
    check(
      forbidden(
        await transition('discard_case_draft', client.token, {
          p_case_id: draftId,
          p_case_version: 1,
          p_idempotency_key: uuidV4(),
        }),
      ),
      `${client.email}: a client cannot discard a draft (403)`,
    );
    const discardKey = uuidV4();
    const discardArgs = { p_case_id: draftId, p_case_version: 1, p_idempotency_key: discardKey };
    const discarded = await transition('discard_case_draft', intake.token, discardArgs);
    check(
      discarded.status === 200 && discarded.body?.discarded === true,
      `${intake.email}: discards the empty draft`,
    );
    const gone = await rest(`/cases?select=id&id=eq.${draftId}`, client.token);
    check(
      gone.status === 200 && (gone.body ?? []).length === 0,
      `${client.email}: the discarded draft is gone from their view`,
    );
    const discardedAgain = await transition('discard_case_draft', intake.token, discardArgs);
    check(
      discardedAgain.status === 200 && discardedAgain.body?.discarded === true,
      `${intake.email}: the same key replays the discard after the row is gone`,
    );
  }

  const openedDrafts = [];
  let refusedAt = null;
  for (let attempt = 0; attempt < OPEN_LIMIT + 2; attempt += 1) {
    const one = await openCase(intake.token, {
      p_title: `Harness bound ${tag} ${attempt} (Synthetic)`,
    });
    if (one.status === 200 && typeof one.body?.case_id === 'string') {
      openedDrafts.push(one.body.case_id);
      continue;
    }
    refusedAt = { attempt, result: one };
    break;
  }
  const draftsInScope = await asServer(
    `/rest/v1/cases?select=id&entity_id=eq.${SCOPE.entityA2}&status=eq.DRAFT`,
  );
  check(
    refusedAt !== null &&
      refused(refusedAt.result, 'too_many_drafts') &&
      draftsInScope.status === 200 &&
      (draftsInScope.body ?? []).length === OPEN_LIMIT,
    `${intake.email}: the ${OPEN_LIMIT}-draft bound per workspace holds (too_many_drafts at exactly ${OPEN_LIMIT} drafts)`,
  );
  let discardedAll = true;
  for (const id of openedDrafts) {
    const result = await transition('discard_case_draft', intake.token, {
      p_case_id: id,
      p_case_version: 1,
      p_idempotency_key: uuidV4(),
    });
    if (result.status !== 200) discardedAll = false;
  }
  const draftsLeft = await asServer(
    `/rest/v1/cases?select=id&entity_id=eq.${SCOPE.entityA2}&status=eq.DRAFT`,
  );
  check(
    discardedAll && draftsLeft.status === 200 && (draftsLeft.body ?? []).length === 0,
    `${intake.email}: every bound draft is discarded again (the workspace holds no draft)`,
  );

  // ---- receipts: ids and facts, never the words ----
  const receipts = await asServer(
    `/rest/v1/audit_receipts?select=action,object_ref,details&or=(object_ref.eq.case:${caseId},object_ref.eq.request:${firstId},object_ref.eq.request:${secondId})&order=occurred_at.asc`,
  );
  const actions = (receipts.body ?? []).map((receipt) => receipt.action);
  const expectedActions = [
    'case.opened',
    'case.intake_recorded',
    'request.opened',
    'request.opened',
    'request.closed',
  ];
  check(
    receipts.status === 200 &&
      expectedActions.every((action) => actions.includes(action)) &&
      actions.length === expectedActions.length,
    `server: the receipts are exactly one per change (${expectedActions.join(', ')})`,
  );
  const serialized = JSON.stringify(receipts.body ?? []);
  check(
    !serialized.includes(title) &&
      !serialized.includes(requestTitle) &&
      !serialized.includes('July statement') &&
      !serialized.includes('Synthetic'),
    'server: no receipt carries a title or a detail — ids, versions, statuses and facts only',
  );
  const firstReceipt = (receipts.body ?? []).find(
    (receipt) => receipt.action === 'request.opened' && receipt.object_ref === `request:${firstId}`,
  );
  check(
    firstReceipt?.details?.acting_role === 'intake' &&
      firstReceipt.details.due_in_days === 14 &&
      firstReceipt.details.subject_document_id === null &&
      firstReceipt.details.result?.case_status === 'EVIDENCE_PENDING',
    'server: the request receipt records the acting role, the due window, the absent subject, and the case it moved',
  );
}
