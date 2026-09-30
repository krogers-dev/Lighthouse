/** The review tenant's sign-in (WO-008 and its fallback WO-009) as real
 * requests against GoTrue's password grant and the server-role window
 * functions, for the black-box harness (step 4e), run after the
 * release-controls path.
 *
 * With the tenant seeded and registered: a code set while no window is
 * open is useless (the hook refuses it, or without the hook the trigger
 * replaced it as it was written); the server role opens a window and the
 * code is set; the review identity signs in with the code (its JWT names
 * the canonical id) and reads exactly the review environment's rows,
 * none of the seeded clients'; a wrong code is refused (and counted only
 * where the hook runs); a seeded client with a password of its own is
 * refused; the sweep, run as of a later moment, expires the window, the
 * code and the session with it; a second window closes on request with
 * the same effect; every step is on the audit trail. The tenant is
 * retired at the end.
 *
 * ctx.hookMode says whether GoTrue's password-verification hook is
 * enabled on this stack (HIVE_REVIEW_HOOK=on); the fallback holds either
 * way, and the counting assertion flips with it.
 *
 * ctx.reviewEmail is the review identity's address on this stack (the
 * synthetic one locally, Honeybee's review mailbox on a hosted project).
 * ctx.otherIdentity is the identity the "anyone else" negative is run
 * against: the seeded client owner locally, and on a hosted project a
 * throwaway the proof creates and deletes (WO-011), since a hosted
 * project holds no seeded identity GoTrue can load.
 */
import { REVIEW_TENANT } from './review-tenant.mjs';

export async function assertReviewTenantPath(ctx) {
  const {
    rest,
    check,
    uuidV4,
    url,
    clientKey,
    serviceKey,
    gatewayKey,
    seedReview,
    retireReview,
    hookMode = false,
    reviewEmail = REVIEW_TENANT.identity.email,
    otherIdentity = {
      id: 'cccccccc-0000-4000-8000-000000000001',
      email: 'client.owner@example.invalid',
      label: 'a seeded client',
    },
  } = ctx;
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
  const refreshGrant = async (refreshToken) => {
    const response = await fetch(`${url}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { apikey: clientKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
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
  const refused = (attempt) => attempt.status >= 400 && attempt.status < 500;

  const seeded = await seedReview();
  if (!check(seeded, 'review tenant: seeded and registered on demand')) return;
  const code = `review-code-${uuidV4()}`;

  // No window: a code set now is useless, whichever mechanism refuses it.
  check(
    (await setPassword(t.identity.id, code)) === 200,
    'review tenant: the code is set as the review identity’s password while no window is open',
  );
  const closedAttempt = await passwordGrant(reviewEmail, code);
  check(
    refused(closedAttempt),
    `review tenant: the review identity is refused while no window is open (${closedAttempt.status})`,
  );

  // Open a window, then set the code, as the tooling does.
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
  check(
    (await setPassword(t.identity.id, code)) === 200,
    'review tenant: the code is set inside the window',
  );
  const wrong = await passwordGrant(reviewEmail, `${code}-wrong`);
  check(refused(wrong), `review tenant: a wrong code is refused (${wrong.status})`);
  const status = await serverCall('/rest/v1/rpc/review_window_status', {});
  if (hookMode) {
    check(
      status.status === 200 && status.body?.open === true && status.body?.failed_attempts === 1,
      'server role: the wrong code was counted against the window (hook mode)',
    );
  } else {
    check(
      status.status === 200 && status.body?.open === true && status.body?.failed_attempts === 0,
      'server role: without the hook a wrong code is not counted; the rate limit and the code’s length bound it (fallback mode)',
    );
  }
  check(
    status.status === 200 && typeof status.body?.sweep === 'object' && status.body.sweep !== null,
    'server role: the status carries the sweep state',
  );
  const signedIn = await passwordGrant(reviewEmail, code);
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
  const firstRefresh = signedIn.body.refresh_token;
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

  // Anyone else with a password of their own is not the review identity.
  const ownerCode = `owner-code-${uuidV4()}`;
  check(
    (await setPassword(otherIdentity.id, ownerCode)) === 200,
    `review tenant: ${otherIdentity.label} is given a password for the negative`,
  );
  const ownerAttempt = await passwordGrant(otherIdentity.email, ownerCode);
  check(
    refused(ownerAttempt),
    `review tenant: anyone but the review identity is refused the password grant even with a valid password (${ownerAttempt.status})`,
  );

  // Expiry: the sweep, as of two hours on, ends the window nobody closed.
  const swept = await serverCall('/rest/v1/rpc/review_sweep', {
    p_as_of: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
  });
  check(
    swept.status === 200 && swept.body?.expired === 1,
    `server role: the sweep expires the window whose close time has passed (${JSON.stringify(swept.body)})`,
  );
  const afterExpiry = await passwordGrant(reviewEmail, code);
  check(
    refused(afterExpiry),
    `review tenant: the code is refused once the window expired (${afterExpiry.status})`,
  );
  const refreshAfterExpiry = await refreshGrant(firstRefresh);
  check(
    refused(refreshAfterExpiry),
    `review tenant: the session issued inside the window cannot be refreshed after expiry (${refreshAfterExpiry.status})`,
  );

  // A second window closes on request, with the same effect.
  const reopened = await serverCall('/rest/v1/rpc/open_review_window', {
    p_hours: 1,
    p_idempotency_key: uuidV4(),
  });
  check(reopened.status === 200, 'server role: opens a second window');
  check(
    (await setPassword(t.identity.id, code)) === 200,
    'review tenant: the code is set again inside the second window',
  );
  const secondSignIn = await passwordGrant(reviewEmail, code);
  check(
    secondSignIn.status === 200 && typeof secondSignIn.body?.refresh_token === 'string',
    'review tenant: the review identity signs in inside the second window',
  );
  const closed = await serverCall('/rest/v1/rpc/close_review_window', {
    p_idempotency_key: uuidV4(),
  });
  check(closed.status === 200, 'server role: closes the window');
  const afterClose = await passwordGrant(reviewEmail, code);
  check(
    refused(afterClose),
    `review tenant: the code is refused once the window is closed (${afterClose.status})`,
  );
  const refreshAfterClose = await refreshGrant(secondSignIn.body?.refresh_token ?? '');
  check(
    refused(refreshAfterClose),
    `review tenant: the session issued inside the second window cannot be refreshed after the close (${refreshAfterClose.status})`,
  );

  // The trail, read by the server role.
  const audit = await fetch(
    `${url}/rest/v1/audit_receipts?select=action,details&environment_id=eq.${t.environmentId}&action=like.review.*`,
    { headers: server },
  );
  const rows = (await audit.json().catch(() => [])) ?? [];
  const actions = rows.map((row) => row.action);
  const closeReasons = rows
    .filter((row) => row.action === 'review.window_closed')
    .map((row) => row.details?.reason);
  check(
    ['review.identity_registered', 'review.window_opened', 'review.window_closed'].every((action) =>
      actions.includes(action),
    ) &&
      closeReasons.includes('expired') &&
      closeReasons.includes('closed') &&
      (!hookMode ||
        (actions.includes('review.sign_in_refused') && actions.includes('review.signed_in'))),
    'review tenant: every step is on the audit trail, in the review environment’s scope, with both close reasons',
  );

  const retired = await retireReview();
  check(
    retired,
    'review tenant: retired (window closed, code replaced, identity unregistered, membership removed)',
  );
  const afterRetire = await passwordGrant(reviewEmail, code);
  check(
    refused(afterRetire),
    `review tenant: nothing signs in after retirement (${afterRetire.status})`,
  );
}
