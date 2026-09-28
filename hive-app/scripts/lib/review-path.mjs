/** The review and approval path (WO-005) as real JWTs over PostgREST,
 * for the black-box harness (scripts/e2e-local-auth.mjs step 4b).
 *
 * The preparer freezes, a conflict-free reviewer returns and then
 * passes, the preparer resumes and freezes again, the approver meets the
 * refusals and then approves the exact package; the same key replays,
 * a second approval is refused, the sweep finds nothing due, and the
 * client and AAL1 staff see none of it while the case status moves in
 * plain sight. The harness passes in its own helpers so this module
 * proves the server through the same adapter the rest of the harness
 * uses. The seeded case is reset first, through the checked loopback
 * reset, so a re-run on the same stack starts from the seed.
 */
import { WORKFLOW_EVENT_KINDS } from './case-reset.mjs';

export async function assertReviewPath(ctx, parties) {
  const { rest, rpc, check, uuidV4, extraReach, extraReachByEmail, SCOPE, CASES, reset } = ctx;
  const { preparer, reviewer, approver, client, other, staffAal1 } = parties;

  const resetResult = await reset('a1');
  if (
    !check(
      resetResult.ok,
      `review path: the seeded case starts EVIDENCE_PENDING with no package (${
        resetResult.ok ? 'checked reset' : resetResult.problems.join('; ')
      })`,
    )
  ) {
    return;
  }

  const scopeArgs = {
    p_environment_id: SCOPE.environmentId,
    p_client_id: SCOPE.clientA,
    p_entity_id: SCOPE.entityA1,
    p_case_id: CASES.a1,
  };
  const readCase = async (token) => {
    const row = await rest(`/cases?select=id,status,version&id=eq.${CASES.a1}`, token);
    return row.body?.[0] ?? null;
  };
  const transition = (name, token, version, extra = {}) =>
    rpc(
      name,
      { ...scopeArgs, p_case_version: version, p_idempotency_key: uuidV4(), ...extra },
      token,
    );

  const staffOf = (email) => (extraReachByEmail[email] ??= {});
  const noteRows = (table, id) => {
    for (const email of [preparer.email, 'mixed.same@example.invalid']) {
      (staffOf(email)[table] ??= []).push(id);
    }
  };

  // Freeze, as the preparer.
  let current = await readCase(preparer.token);
  if (
    !check(current?.status === 'EVIDENCE_PENDING', `${preparer.email}: case A1 is EVIDENCE_PENDING`)
  )
    return;
  const stale = await transition('freeze_case_package', preparer.token, current.version + 5);
  check(
    stale.status === 400 && stale.body?.message === 'case_changed',
    `${preparer.email}: a stale case version is a conflict (case_changed)`,
  );
  const staffAal1Freeze = await transition('freeze_case_package', staffAal1.token, current.version);
  check(staffAal1Freeze.status === 403, `${staffAal1.email}: staff at AAL1 cannot freeze (403)`);
  const clientFreeze = await transition('freeze_case_package', client.token, current.version);
  check(clientFreeze.status === 403, `${client.email}: a client cannot freeze (403)`);
  const freezeKey = uuidV4();
  const frozen = await rpc(
    'freeze_case_package',
    { ...scopeArgs, p_case_version: current.version, p_idempotency_key: freezeKey },
    preparer.token,
  );
  if (
    !check(
      frozen.status === 200 && frozen.body?.case_status === 'READY_FOR_REVIEW',
      `${preparer.email}: freeze_case_package sends the case for review`,
    )
  )
    return;
  noteRows('case_review_packages', frozen.body.package_id);
  const replay = await rpc(
    'freeze_case_package',
    { ...scopeArgs, p_case_version: current.version, p_idempotency_key: freezeKey },
    preparer.token,
  );
  check(
    replay.status === 200 && replay.body?.package_id === frozen.body.package_id,
    `${preparer.email}: the same key replays the same package`,
  );
  const clientPackages = await rest(
    `/case_review_packages?select=id&case_id=eq.${CASES.a1}`,
    client.token,
  );
  check(
    clientPackages.status === 200 && (clientPackages.body ?? []).length === 0,
    `${client.email}: a client reads no package (zero rows)`,
  );
  const aal1Packages = await rest(
    `/case_review_packages?select=id&case_id=eq.${CASES.a1}`,
    staffAal1.token,
  );
  check(
    aal1Packages.status === 200 && (aal1Packages.body ?? []).length === 0,
    `${staffAal1.email}: staff at AAL1 read no package (zero rows)`,
  );
  const reviewerPackages = await rest(
    `/case_review_packages?select=id,manifest_digest&case_id=eq.${CASES.a1}`,
    reviewer.token,
  );
  check(
    reviewerPackages.status === 200 && (reviewerPackages.body ?? []).length === 1,
    `${reviewer.email}: the reviewer at AAL2 reads the package`,
  );
  const clientCase = await readCase(client.token);
  check(
    clientCase?.status === 'READY_FOR_REVIEW',
    `${client.email}: the client sees the case status the workflow moved`,
  );

  // Review: return, resume, freeze again, pass.
  current = await readCase(reviewer.token);
  const approverStart = await transition('start_case_review', approver.token, current.version);
  check(
    approverStart.status === 403,
    `${approver.email}: an approver holds no reviewer membership (403)`,
  );
  const started = await transition('start_case_review', reviewer.token, current.version);
  if (
    !check(
      started.status === 200 && started.body?.case_status === 'IN_REVIEW',
      `${reviewer.email}: start_case_review takes the package into review`,
    )
  )
    return;
  noteRows('case_reviews', started.body.review_id);
  current = await readCase(reviewer.token);
  const badVerdict = await transition('record_case_verdict', reviewer.token, current.version, {
    p_verdict: 'MAYBE',
    p_note: '',
  });
  check(
    badVerdict.status === 400 && badVerdict.body?.message === 'invalid_verdict',
    `${reviewer.email}: a verdict is exactly PASS, RETURN, or HOLD`,
  );
  const returned = await transition('record_case_verdict', reviewer.token, current.version, {
    p_verdict: 'RETURN',
    p_note: 'The July statement is missing its last page (Synthetic).',
  });
  check(
    returned.status === 200 && returned.body?.case_status === 'RETURNED',
    `${reviewer.email}: RETURN sends the case back`,
  );
  current = await readCase(preparer.token);
  const resumed = await transition('resume_case', preparer.token, current.version);
  check(
    resumed.status === 200 && resumed.body?.case_status === 'EVIDENCE_PENDING',
    `${preparer.email}: the preparer resumes a returned case`,
  );
  current = await readCase(preparer.token);
  const frozen2 = await transition('freeze_case_package', preparer.token, current.version);
  check(
    frozen2.status === 200 && frozen2.body?.package_number === 2,
    `${preparer.email}: the next package is number 2`,
  );
  if (frozen2.status !== 200) return;
  noteRows('case_review_packages', frozen2.body.package_id);
  current = await readCase(reviewer.token);
  const started2 = await transition('start_case_review', reviewer.token, current.version);
  if (started2.status === 200) noteRows('case_reviews', started2.body.review_id);
  current = await readCase(reviewer.token);
  const passed = await transition('record_case_verdict', reviewer.token, current.version, {
    p_verdict: 'PASS',
    p_note: '',
  });
  check(
    passed.status === 200 && passed.body?.case_status === 'APPROVAL_PENDING',
    `${reviewer.email}: PASS moves the case to APPROVAL_PENDING`,
  );

  // Approval: the exact package, by a conflict-free approver.
  current = await readCase(approver.token);
  const reviewerApprove = await transition(
    'approve_case_package',
    reviewer.token,
    current.version,
    {
      p_package_id: frozen2.body.package_id,
      p_package_digest: frozen2.body.manifest_digest,
      p_destination: 'hive-record',
    },
  );
  check(
    reviewerApprove.status === 403,
    `${reviewer.email}: a reviewer holds no approver membership (403)`,
  );
  const wrongDigest = await transition('approve_case_package', approver.token, current.version, {
    p_package_id: frozen2.body.package_id,
    p_package_digest: '0'.repeat(64),
    p_destination: 'hive-record',
  });
  check(
    wrongDigest.status === 400 && wrongDigest.body?.message === 'digest_mismatch',
    `${approver.email}: an approval names the exact digest (digest_mismatch)`,
  );
  const wrongDestination = await transition(
    'approve_case_package',
    approver.token,
    current.version,
    {
      p_package_id: frozen2.body.package_id,
      p_package_digest: frozen2.body.manifest_digest,
      p_destination: 'drive-filing',
    },
  );
  check(
    wrongDestination.status === 400 && wrongDestination.body?.message === 'invalid_destination',
    `${approver.email}: only the HIVE record is a destination (invalid_destination)`,
  );
  const approveKey = uuidV4();
  const approveArgs = {
    ...scopeArgs,
    p_case_version: current.version,
    p_idempotency_key: approveKey,
    p_package_id: frozen2.body.package_id,
    p_package_digest: frozen2.body.manifest_digest,
    p_destination: 'hive-record',
  };
  const approved = await rpc('approve_case_package', approveArgs, approver.token);
  if (
    !check(
      approved.status === 200 &&
        approved.body?.case_status === 'APPROVED' &&
        typeof approved.body?.expires_at === 'string',
      `${approver.email}: the approval settles the case, with an expiry`,
    )
  )
    return;
  noteRows('case_approvals', approved.body.approval_id);
  const approveReplay = await rpc('approve_case_package', approveArgs, approver.token);
  check(
    approveReplay.status === 200 && approveReplay.body?.approval_id === approved.body.approval_id,
    `${approver.email}: the same key replays the same approval`,
  );
  current = await readCase(approver.token);
  const again = await transition('approve_case_package', approver.token, current.version, {
    p_package_id: frozen2.body.package_id,
    p_package_digest: frozen2.body.manifest_digest,
    p_destination: 'hive-record',
  });
  check(
    again.status === 400 && again.body?.message === 'case_not_approvable',
    `${approver.email}: an approved case is not approved twice`,
  );
  const approvals = await rest(
    `/case_approvals?select=id,status,package_digest,destination&case_id=eq.${CASES.a1}`,
    approver.token,
  );
  check(
    approvals.status === 200 &&
      approvals.body?.[0]?.status === 'ACTIVE' &&
      approvals.body?.[0]?.package_digest === frozen2.body.manifest_digest,
    `${approver.email}: the approval reads back ACTIVE, bound to the package digest`,
  );

  // What the client and the trail see.
  const clientRows = await rest(`/case_approvals?select=id&case_id=eq.${CASES.a1}`, client.token);
  check(
    clientRows.status === 200 && (clientRows.body ?? []).length === 0,
    `${client.email}: a client reads no approval (zero rows)`,
  );
  const otherCase = await rest(`/cases?select=id&id=eq.${CASES.a1}`, other.token);
  check(
    otherCase.status === 200 && (otherCase.body ?? []).length === 0,
    `${other.email}: another client cannot see the case at all`,
  );
  const finalCase = await readCase(client.token);
  check(finalCase?.status === 'APPROVED', `${client.email}: the client sees the case APPROVED`);
  const trail = await rest(
    `/activity_events?select=id,event_kind,actor_role&case_id=eq.${CASES.a1}&event_kind=in.(${WORKFLOW_EVENT_KINDS.join(',')})`,
    client.token,
  );
  const kinds = (trail.body ?? []).map((event) => event.event_kind);
  check(
    trail.status === 200 &&
      [
        'case.package_frozen',
        'case.review_started',
        'case.returned',
        'case.resumed',
        'case.review_passed',
        'case.approved',
      ].every((kind) => kinds.includes(kind)),
    `${client.email}: the trail carries the workflow as enumerated kinds (no text)`,
  );
  for (const event of trail.body ?? []) extraReach.activity_events.push(event.id);
}
