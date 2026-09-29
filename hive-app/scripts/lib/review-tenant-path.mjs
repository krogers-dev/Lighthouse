/** The review tenant's sign-in (WO-008, option A) as real requests against
 * GoTrue's password grant and the server-role window functions, for the
 * black-box harness (step 4e), run after the release-controls path.
 *
 * With the tenant seeded and registered: the review identity is refused
 * while no window is open; the server role opens a window and sets the
 * code; the review identity signs in with the code (its JWT names the
 * canonical id) and reads exactly the review environment's rows, none of
 * the seeded clients'; a wrong code is refused and counted; a seeded
 * client with a password of its own is refused (not the review
 * identity); the window closes and the code is refused again; every
 * attempt is on the audit trail. The tenant is retired at the end.
 */
import { REVIEW_TENANT } from './review-tenant.mjs';

export async function assertReviewTenantPath(ctx) {
  const { rest, check, uuidV4, url, clientKey, serviceKey, gatewayKey, seedReview, retireReview } =
    ctx;
  const t = REVIEW_TENANT;
  const server = {
    apikey: gatewayKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
  };
  const serverCall = async (pathname, body) => {
    const response = await fetch(`${url}${pathname}`, {
      method: 'POST',
      headers: server,
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json().catch(() => null) };
  };
  const passwordGrant = async (email, password) => {
    const response = await fetch(`${url}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: clientKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    return { status: response.status, body: await response.json().catch(() => null) };
  };
  const setPassword = async (userId, password) => {
    const response = await fetch(`${url}/auth/v1/admin/users/${userId}`, {
      method: 'PUT',
      headers: server,
      body: JSON.stringify({ password }),
    });
    return response.status;
  };

  const seeded = await seedReview();
  if (!check(seeded, 'review tenant: seeded and registered on demand')) return;
  const code = `review-code-${uuidV4()}`;
  check(
    (await setPassword(t.identity.id, code)) === 200,
    'review tenant: the code is set as the review identity’s password',
  );

  // No window: refused, even with the right code.
  const closedAttempt = await passwordGrant(t.identity.email, code);
  check(
    closedAttempt.status >= 400 && closedAttempt.status < 500,
    `review tenant: the review identity is refused while no window is open (${closedAttempt.status})`,
  );

  // Open a window.
  const opened = await serverCall('/rest/v1/rpc/open_review_window', {
    p_hours: 1,
    p_idempotency_key: uuidV4(),
  });
  if (
    !check(
      opened.status === 200 && typeof opened.body?.window_id === 'string',
      'server role: opens a review window',
    )
  ) {
    await retireReview();
    return;
  }
  const wrong = await passwordGrant(t.identity.email, `${code}-wrong`);
  check(
    wrong.status >= 400 && wrong.status < 500,
    `review tenant: a wrong code is refused (${wrong.status})`,
  );
  const status = await serverCall('/rest/v1/rpc/review_window_status', {});
  check(
    status.status === 200 && status.body?.open === true && status.body?.failed_attempts === 1,
    'server role: the wrong code was counted against the window',
  );
  const signedIn = await passwordGrant(t.identity.email, code);
  if (
    !check(
      signedIn.status === 200 && typeof signedIn.body?.access_token === 'string',
      'review tenant: the review identity signs in with the code inside the window',
    )
  ) {
    await retireReview();
    return;
  }
  const token = signedIn.body.access_token;
  const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
  check(
    payload.sub === t.identity.id,
    'review tenant: the JWT names the canonical review identity',
  );

  // Reach: exactly the review environment.
  const cases = await rest('/cases?select=id', token);
  check(
    cases.status === 200 && (cases.body ?? []).length === 1 && cases.body[0].id === t.caseId,
    'review tenant: reads exactly the review case and none of the seeded clients’ cases',
  );
  const requests = await rest('/requests?select=id', token);
  check(
    requests.status === 200 && (requests.body ?? []).length === 2,
    'review tenant: reads the two review requests',
  );
  const environments = await rest('/environments?select=id', token);
  check(
    environments.status === 200 &&
      (environments.body ?? []).length === 1 &&
      environments.body[0].id === t.environmentId,
    'review tenant: sees only the review environment',
  );

  // A seeded client with a password of its own is not the review identity.
  const ownerId = 'cccccccc-0000-4000-8000-000000000001';
  const ownerCode = `owner-code-${uuidV4()}`;
  check(
    (await setPassword(ownerId, ownerCode)) === 200,
    'review tenant: a seeded client is given a password for the negative',
  );
  const ownerAttempt = await passwordGrant('client.owner@example.invalid', ownerCode);
  check(
    ownerAttempt.status >= 400 && ownerAttempt.status < 500,
    `review tenant: anyone but the review identity is refused the password grant even with a valid password (${ownerAttempt.status})`,
  );
  await setPassword(ownerId, `scrambled-${uuidV4()}-${uuidV4()}`);

  // Close: refused again.
  const closed = await serverCall('/rest/v1/rpc/close_review_window', {
    p_idempotency_key: uuidV4(),
  });
  check(closed.status === 200, 'server role: closes the window');
  const afterClose = await passwordGrant(t.identity.email, code);
  check(
    afterClose.status >= 400 && afterClose.status < 500,
    `review tenant: the code is refused once the window is closed (${afterClose.status})`,
  );

  // The trail, read by the server role.
  const audit = await fetch(
    `${url}/rest/v1/audit_receipts?select=action&environment_id=eq.${t.environmentId}&action=like.review.*`,
    { headers: server },
  );
  const actions = ((await audit.json().catch(() => [])) ?? []).map((row) => row.action);
  check(
    [
      'review.identity_registered',
      'review.window_opened',
      'review.sign_in_refused',
      'review.signed_in',
      'review.window_closed',
    ].every((action) => actions.includes(action)),
    'review tenant: every step is on the audit trail, in the review environment’s scope',
  );

  const retired = await retireReview();
  check(
    retired,
    'review tenant: retired (window closed, code replaced, identity unregistered, membership removed)',
  );
  const afterRetire = await passwordGrant(t.identity.email, code);
  check(
    afterRetire.status >= 400 && afterRetire.status < 500,
    `review tenant: nothing signs in after retirement (${afterRetire.status})`,
  );
}
