/** Onboarding (WO-012) as real requests, for the black-box harness, run
 * after the release-controls path and before the review tenant.
 *
 * The operator tooling (scripts/onboarding.mjs, the same tool the hosted
 * runner uses) brings a new client and entity into the environment and
 * invites two people: a client user and an intake staff member. Then the
 * invited people act through the public endpoints alone: the client signs
 * in with an emailed code and reads exactly the one entity they were
 * given, and nothing of the seeded clients; they cannot grant a
 * membership or onboard anything themselves; the staff member reads
 * nothing at AAL1 and exactly their entity once an authenticator is
 * enrolled; a revocation empties the client's reads in the session they
 * already hold; every change left a receipt in the new scope, and no
 * receipt carries an address or a name. The two identities are removed at
 * the end; the entity stays, under a name unique to the run.
 */

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

export async function assertOnboardingPath(ctx) {
  const {
    rest,
    rpc,
    check,
    uuidV4,
    url,
    serviceKey,
    gatewayKey,
    runTool,
    signInWithOtp,
    enrollAndVerifyTotp,
  } = ctx;
  const server = {
    apikey: gatewayKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
  };
  const asServer = async (pathname, options = {}) => {
    const response = await fetch(`${url}${pathname}`, { ...options, headers: server });
    return { status: response.status, body: await response.json().catch(() => null) };
  };

  const tag = uuidV4().slice(0, 8);
  const clientName = `Onboarding Harness Client ${tag} (Synthetic)`;
  const entityName = `Onboarding Harness Entity ${tag} (Synthetic)`;
  const clientEmail = `onboarded.client.${tag}@example.invalid`;
  const staffEmail = `onboarded.intake.${tag}@example.invalid`;

  // The operator brings the entity in.
  const onboarded = runTool('onboard-entity', [clientName, entityName]);
  const ids = new RegExp(
    `entity (${UUID}) onboarded under client (${UUID}) \\(client created\\)`,
  ).exec(onboarded.stdout);
  if (
    !check(
      onboarded.ok && ids !== null,
      'onboarding: the operator onboards a new client and entity',
    )
  ) {
    return;
  }
  const [, entityId, clientId] = ids;
  const again = runTool('onboard-entity', [clientName.toLowerCase(), entityName]);
  check(
    !again.ok && /entity_exists/.test(again.stderr),
    'onboarding: the same entity cannot be onboarded twice, whatever the case of the names',
  );

  // The operator invites a client user.
  const invited = runTool('invite', [clientEmail, 'client_user', entityId]);
  const invitedId = new RegExp(`\\((${UUID})\\) holds client_user`).exec(invited.stdout)?.[1];
  if (
    !check(
      invited.ok &&
        Boolean(invitedId) &&
        /identity created; membership granted/.test(invited.stdout),
      'onboarding: the operator invites a client user, whose identity is created',
    )
  ) {
    return;
  }
  check(
    !invited.stdout.includes(clientEmail),
    'onboarding: the tooling never prints the whole address',
  );
  const repeat = runTool('invite', [clientEmail.toUpperCase(), 'client_user', entityId]);
  check(
    repeat.ok && /existing identity; membership already held/.test(repeat.stdout),
    'onboarding: inviting the same person again creates nothing and grants nothing twice',
  );

  // The invited client signs in with an emailed code and reads their scope.
  const session = await signInWithOtp({ id: invitedId, email: clientEmail });
  if (!session) return;
  const token = session.access_token;
  const entities = await rest('/entities?select=id', token);
  check(
    entities.status === 200 && entities.body?.length === 1 && entities.body[0].id === entityId,
    'onboarding: the invited client reads exactly the one entity they were given',
  );
  const clients = await rest('/clients?select=id', token);
  check(
    clients.status === 200 && clients.body?.length === 1 && clients.body[0].id === clientId,
    'onboarding: and exactly its client, none of the seeded ones',
  );
  const cases = await rest('/cases?select=id', token);
  check(
    cases.status === 200 && cases.body?.length === 0,
    'onboarding: and no case, because none has been opened there',
  );
  const selfGrant = await rpc(
    'grant_membership',
    {
      p_user_id: invitedId,
      p_environment_id: ctx.SCOPE.environmentId,
      p_client_id: ctx.SCOPE.clientA,
      p_entity_id: ctx.SCOPE.entityA1,
      p_role: 'client_user',
      p_idempotency_key: uuidV4(),
    },
    token,
  );
  check(
    selfGrant.status >= 400 && selfGrant.status < 500,
    `onboarding: the invited client cannot grant themselves a membership (${selfGrant.status})`,
  );
  const selfOnboard = await rpc(
    'onboard_entity',
    {
      p_environment_name: 'local-development',
      p_environment_kind: 'development',
      p_client_name: clientName,
      p_entity_name: `${entityName} two`,
      p_idempotency_key: uuidV4(),
    },
    token,
  );
  check(
    selfOnboard.status >= 400 && selfOnboard.status < 500,
    `onboarding: nor onboard an entity (${selfOnboard.status})`,
  );
  const lookup = await rpc(
    'operator_user_id_by_email',
    { p_email: 'client.owner@example.invalid' },
    token,
  );
  check(
    lookup.status >= 400 && lookup.status < 500,
    `onboarding: nor look another person up by address (${lookup.status})`,
  );

  // A staff member: nothing at AAL1, their entity at AAL2.
  const staffInvite = runTool('invite', [staffEmail, 'intake', entityId]);
  const staffId = new RegExp(`\\((${UUID})\\) holds intake`).exec(staffInvite.stdout)?.[1];
  if (
    check(
      staffInvite.ok && Boolean(staffId),
      'onboarding: the operator invites an intake staff member',
    )
  ) {
    const staffSession = await signInWithOtp({ id: staffId, email: staffEmail });
    if (staffSession) {
      const atAal1 = await rest('/entities?select=id', staffSession.access_token);
      check(
        atAal1.status === 200 && atAal1.body?.length === 0,
        'onboarding: the invited staff member reads nothing before an authenticator is enrolled',
      );
      const enrolled = await enrollAndVerifyTotp(
        { id: staffId, email: staffEmail },
        staffSession,
        'onboarding: the invited staff member',
      );
      if (enrolled) {
        const atAal2 = await rest('/entities?select=id', enrolled.session.access_token);
        check(
          atAal2.status === 200 && atAal2.body?.length === 1 && atAal2.body[0].id === entityId,
          'onboarding: and exactly their entity once it is',
        );
      }
    }
  }

  // Revocation ends access in the session already held.
  const access = runTool('list-access', [entityId]);
  check(
    access.ok && /2 membership\(s\)/.test(access.stdout) && !access.stdout.includes(clientEmail),
    'onboarding: the access list names both roles and shows no whole address',
  );
  const revoked = runTool('revoke-access', [clientEmail, 'client_user', entityId]);
  check(
    revoked.ok && /no longer holds client_user/.test(revoked.stdout),
    'onboarding: the operator revokes the client user',
  );
  const afterRevoke = await rest('/entities?select=id', token);
  check(
    afterRevoke.status === 200 && afterRevoke.body?.length === 0,
    'onboarding: and the same session reads nothing at once',
  );

  // The trail, read by the server role.
  const receipts = await asServer(
    `/rest/v1/audit_receipts?select=action,actor_user_id,details&entity_id=eq.${entityId}`,
  );
  const rows = receipts.body ?? [];
  const count = (action) => rows.filter((row) => row.action === action).length;
  check(
    receipts.status === 200 &&
      count('entity.onboarded') === 1 &&
      count('membership.granted') === 3 &&
      count('membership.revoked') === 1 &&
      rows.every((row) => row.actor_user_id === null),
    `onboarding: every change left a receipt in the new scope (${rows.map((row) => row.action).join(', ')})`,
  );
  const text = JSON.stringify(rows);
  check(
    !text.includes('@') && !text.includes(clientName) && !text.includes(entityName),
    'onboarding: and no receipt carries an address or a name',
  );

  // The two identities go; the memberships go with them.
  for (const id of [invitedId, staffId].filter(Boolean)) {
    const removed = await asServer(`/auth/v1/admin/users/${id}`, { method: 'DELETE' });
    check(removed.status === 200, `onboarding: the run's identity ${id.slice(0, 8)} is removed`);
  }
  const left = await asServer(`/rest/v1/memberships?select=id&entity_id=eq.${entityId}`);
  check(
    left.status === 200 && (left.body ?? []).length === 0,
    'onboarding: and no membership is left on the entity',
  );
}
