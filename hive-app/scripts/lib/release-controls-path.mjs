/** The release controls (WO-007) as real JWTs over PostgREST plus the
 * server-role switch, for the black-box harness (step 4d), run after the
 * source path on the same identities.
 *
 * The kill switch: anyone reads the public status; only the server role
 * flips it; while paused every client and staff read returns zero rows
 * and every transition is refused with `service_paused`, the deletion
 * request stays reachable, and nothing is removed; resuming restores the
 * rows exactly (the exact-reach proofs that follow prove it). The
 * deletion request: a person asks, replays, cannot ask twice, reads only
 * their own, withdraws, and asks again; another person reads none of it;
 * the completion itself is the operator tooling's drill (pgTAP proves the
 * function). The rows are counted into the person's exact-reach set.
 */
import { readServiceState, setServiceState } from './service-state.mjs';

export async function assertReleaseControlsPath(ctx, parties) {
  const {
    rest,
    rpc,
    check,
    uuidV4,
    extraReachByEmail,
    CASES,
    url,
    serviceKey,
    gatewayKey,
    clientKey,
  } = ctx;
  const { client, other, staff } = parties;
  const switchArgs = { url, serviceKey, gatewayKey };
  const personal = (email) => (extraReachByEmail[email] ??= {});

  // The switch belongs to the server role.
  const clientFlip = await rpc(
    'set_service_state',
    {
      p_state: 'paused',
      p_reason_code: 'incident',
      p_min_app_version: '0.0.0',
      p_idempotency_key: uuidV4(),
    },
    client.token,
  );
  check(
    clientFlip.status === 403 || clientFlip.status === 401,
    `${client.email}: a client cannot flip the service switch (${clientFlip.status})`,
  );
  const staffFlip = await rpc(
    'set_service_state',
    {
      p_state: 'paused',
      p_reason_code: 'incident',
      p_min_app_version: '0.0.0',
      p_idempotency_key: uuidV4(),
    },
    staff.token,
  );
  check(
    staffFlip.status === 403 || staffFlip.status === 401,
    `${staff.email}: staff cannot flip the service switch (${staffFlip.status})`,
  );
  const before = await readServiceState(switchArgs);
  if (
    !check(
      before.ok && before.status.state === 'open',
      'server role: the service reads open before the drill',
    )
  ) {
    return;
  }
  const clientCasesOpen = await rest(`/cases?select=id&id=eq.${CASES.a1}`, client.token);
  check(
    clientCasesOpen.status === 200 && (clientCasesOpen.body ?? []).length === 1,
    `${client.email}: reads case A1 while the service is open`,
  );

  // Pause: zero rows, refused transitions, the status readable by all.
  const pauseKey = uuidV4();
  const paused = await setServiceState({
    ...switchArgs,
    state: 'paused',
    reasonCode: 'incident',
    idempotencyKey: pauseKey,
  });
  if (!check(paused.ok && paused.status.state === 'paused', 'server role: pauses the service'))
    return;
  const replayed = await setServiceState({
    ...switchArgs,
    state: 'paused',
    reasonCode: 'incident',
    idempotencyKey: pauseKey,
  });
  check(
    replayed.ok &&
      replayed.status.replayed === true &&
      replayed.status.version === paused.status.version,
    'server role: the same key replays the same change',
  );
  const anonStatus = await rpc('service_status_read', {}, clientKey);
  check(
    anonStatus.status === 200 &&
      anonStatus.body?.state === 'paused' &&
      anonStatus.body?.reason_code === 'incident',
    'anon: reads the paused status with its reason code through the one public function',
  );
  const clientCasesPaused = await rest(`/cases?select=id`, client.token);
  check(
    clientCasesPaused.status === 200 && (clientCasesPaused.body ?? []).length === 0,
    `${client.email}: paused, reads zero cases`,
  );
  const clientRequestsPaused = await rest(`/requests?select=id`, client.token);
  check(
    clientRequestsPaused.status === 200 && (clientRequestsPaused.body ?? []).length === 0,
    `${client.email}: paused, reads zero requests`,
  );
  const staffCasesPaused = await rest(`/cases?select=id`, staff.token);
  check(
    staffCasesPaused.status === 200 && (staffCasesPaused.body ?? []).length === 0,
    `${staff.email}: paused, staff at AAL2 read zero cases`,
  );
  const staffMembershipsPaused = await rest(`/memberships?select=id`, staff.token);
  check(
    staffMembershipsPaused.status === 200 && (staffMembershipsPaused.body ?? []).length === 0,
    `${staff.email}: paused, even their own memberships read as zero rows`,
  );
  const transitionPaused = await rpc(
    'freeze_case_package',
    {
      p_environment_id: '11111111-0000-4000-8000-000000000001',
      p_client_id: 'aaaaaaaa-0000-4000-8000-000000000001',
      p_entity_id: 'aaaaaaaa-1111-4000-8000-000000000001',
      p_case_id: CASES.a1,
      p_case_version: 1,
      p_idempotency_key: uuidV4(),
    },
    staff.token,
  );
  check(
    transitionPaused.status === 400 && transitionPaused.body?.message === 'service_paused',
    `${staff.email}: paused, a transition is refused before anything else (service_paused)`,
  );

  // The deletion request stays reachable while paused: the person asks.
  const requestKey = uuidV4();
  const requested = await rpc(
    'request_account_deletion',
    { p_idempotency_key: requestKey },
    client.token,
  );
  if (
    !check(
      requested.status === 200 && requested.body?.status === 'REQUESTED',
      `${client.email}: paused, may still ask for their account to be deleted (REQUESTED)`,
    )
  ) {
    await setServiceState({
      ...switchArgs,
      state: 'open',
      reasonCode: 'none',
      idempotencyKey: uuidV4(),
    });
    return;
  }
  (personal(client.email).account_deletion_requests ??= []).push(requested.body.request_id);

  // Resume.
  const resumed = await setServiceState({
    ...switchArgs,
    state: 'open',
    reasonCode: 'none',
    idempotencyKey: uuidV4(),
  });
  check(resumed.ok && resumed.status.state === 'open', 'server role: resumes the service');
  const clientCasesResumed = await rest(`/cases?select=id&id=eq.${CASES.a1}`, client.token);
  check(
    clientCasesResumed.status === 200 && (clientCasesResumed.body ?? []).length === 1,
    `${client.email}: resumed, reads case A1 again; nothing was removed`,
  );

  // The deletion request lifecycle.
  const replay = await rpc(
    'request_account_deletion',
    { p_idempotency_key: requestKey },
    client.token,
  );
  check(
    replay.status === 200 &&
      replay.body?.request_id === requested.body.request_id &&
      replay.body?.replayed === true,
    `${client.email}: the same key replays the same request`,
  );
  const second = await rpc(
    'request_account_deletion',
    { p_idempotency_key: uuidV4() },
    client.token,
  );
  check(
    second.status === 400 && second.body?.message === 'already_requested',
    `${client.email}: one open request at a time (already_requested)`,
  );
  const own = await rest('/account_deletion_requests?select=id,status', client.token);
  check(
    own.status === 200 && (own.body ?? []).length === 1 && own.body[0].status === 'REQUESTED',
    `${client.email}: reads their own open request and nothing else`,
  );
  const others = await rest('/account_deletion_requests?select=id', other.token);
  check(
    others.status === 200 && (others.body ?? []).length === 0,
    `${other.email}: reads no request of anyone else (zero rows)`,
  );
  const foreignWithdraw = await rpc(
    'withdraw_account_deletion',
    { p_idempotency_key: uuidV4() },
    other.token,
  );
  check(
    foreignWithdraw.status === 400 && foreignWithdraw.body?.message === 'no_open_request',
    `${other.email}: cannot withdraw a request that is not theirs (no_open_request)`,
  );
  const anonRequest = await rpc(
    'request_account_deletion',
    { p_idempotency_key: uuidV4() },
    clientKey,
  );
  check(
    anonRequest.status === 401 || anonRequest.status === 403 || anonRequest.status === 404,
    `anon: cannot request a deletion (${anonRequest.status})`,
  );
  const withdrawKey = uuidV4();
  const withdrawn = await rpc(
    'withdraw_account_deletion',
    { p_idempotency_key: withdrawKey },
    client.token,
  );
  check(
    withdrawn.status === 200 && withdrawn.body?.status === 'WITHDRAWN',
    `${client.email}: withdraws the open request (WITHDRAWN)`,
  );
  const withdrawReplay = await rpc(
    'withdraw_account_deletion',
    { p_idempotency_key: withdrawKey },
    client.token,
  );
  check(
    withdrawReplay.status === 200 && withdrawReplay.body?.replayed === true,
    `${client.email}: the same key replays the withdrawal`,
  );
  const again = await rpc(
    'request_account_deletion',
    { p_idempotency_key: uuidV4() },
    client.token,
  );
  check(
    again.status === 200 &&
      again.body?.status === 'REQUESTED' &&
      again.body?.request_id !== requested.body.request_id,
    `${client.email}: may ask again, as a new request`,
  );
  if (again.status === 200) {
    (personal(client.email).account_deletion_requests ??= []).push(again.body.request_id);
    // Leave the seed's person without an open request for the lanes that follow.
    const tidy = await rpc(
      'withdraw_account_deletion',
      { p_idempotency_key: uuidV4() },
      client.token,
    );
    check(
      tidy.status === 200 && tidy.body?.status === 'WITHDRAWN',
      `${client.email}: withdraws again, leaving no open request`,
    );
  }
  const final = await readServiceState(switchArgs);
  check(final.ok && final.status.state === 'open', 'server role: the service ends the drill open');
}
