/** A synthetic staff identity signed in to AAL2, for the local lanes'
 * tooling (WO-005): the case staging command and any lane that must act
 * as a preparer, reviewer, or approver without a device.
 *
 * Exactly the path a person takes, through the stack's public surfaces:
 * factors cleaned through the checked admin helper, a sign-in code
 * requested and read from the bundled test mailbox (snapshot semantics:
 * only a message that arrives after the request is accepted), the code
 * verified to a session, a TOTP factor enrolled and verified with the
 * reviewed TOTP math, and the AAL2 session returned. Loopback URLs only,
 * synthetic example.invalid identities only, the privileged bearer held in
 * memory by the caller and never printed. The factor stays enrolled;
 * `local-supabase.mjs reset-totp <email>` removes it.
 */
import { requireFactorsClean } from './admin-factors.mjs';
import { SYNTHETIC_IDENTITIES } from './synthetic-identities.mjs';
import { totpCode } from './totp.mjs';

const EXPECTED_SUBJECT = 'Your HIVE sign-in code';

function assertLoopback(url) {
  if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(new URL(url).hostname)) {
    throw new Error('staff-session: refusing a non-loopback URL');
  }
}

export function identityFor(email) {
  const identity = SYNTHETIC_IDENTITIES.find((entry) => entry.email === email);
  if (!identity) throw new Error(`staff-session: ${email} is not a synthetic identity`);
  return identity;
}

async function fetchFreshCode(mailpitUrl, email, beforeIds, timeoutMs = 20_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const listing = await fetch(`${mailpitUrl}/api/v1/messages?limit=200`);
    const body = await listing.json().catch(() => ({}));
    const fresh = (body.messages ?? []).find(
      (message) =>
        !beforeIds.has(message.ID) &&
        message.Subject === EXPECTED_SUBJECT &&
        (message.To ?? []).some((to) => (to.Address ?? '').toLowerCase() === email.toLowerCase()),
    );
    if (fresh) {
      const detail = await fetch(`${mailpitUrl}/api/v1/message/${fresh.ID}`);
      const full = await detail.json().catch(() => ({}));
      const text = `${full.Text ?? ''}\n${full.HTML ?? ''}`;
      const distinct = [...new Set(text.match(/\b\d{6}\b/g) ?? [])];
      if (distinct.length !== 1) {
        throw new Error(
          `staff-session: expected one six-digit code for ${email}, found ${distinct.length}`,
        );
      }
      return distinct[0];
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(`staff-session: no sign-in code arrived for ${email} within ${timeoutMs}ms`);
}

/** Sign `email` in to an AAL2 session. Returns `{ accessToken, session, factorId }`. */
export async function signInStaffAal2({
  url,
  clientKey,
  serviceKey,
  gatewayKey,
  mailpitUrl,
  email,
}) {
  assertLoopback(url);
  const identity = identityFor(email);
  const auth = async (pathname, options = {}, bearer = clientKey) => {
    const response = await fetch(`${url}/auth/v1${pathname}`, {
      ...options,
      headers: {
        apikey: clientKey,
        Authorization: `Bearer ${bearer}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });
    return {
      ok: response.ok,
      status: response.status,
      body: await response.json().catch(() => ({})),
    };
  };
  const admin = async (pathname, options = {}) => {
    const response = await fetch(`${url}/auth/v1${pathname}`, {
      ...options,
      headers: {
        apikey: gatewayKey ?? serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });
    return {
      ok: response.ok,
      status: response.status,
      body: await response.json().catch(() => ({})),
    };
  };

  await requireFactorsClean(admin, identity);

  const before = new Set(
    (
      (await (await fetch(`${mailpitUrl}/api/v1/messages?limit=200`)).json().catch(() => ({})))
        .messages ?? []
    ).map((message) => message.ID),
  );
  // GoTrue's one-second send floor per address (find 60): a code requested
  // within a second of the previous one is refused; wait it out once.
  let request = await auth('/otp', {
    method: 'POST',
    body: JSON.stringify({ email, create_user: false }),
  });
  if (request.status === 429) {
    await new Promise((resolve) => setTimeout(resolve, 1200));
    request = await auth('/otp', {
      method: 'POST',
      body: JSON.stringify({ email, create_user: false }),
    });
  }
  if (request.status !== 200) {
    throw new Error(
      `staff-session: the sign-in code request for ${email} answered ${request.status}`,
    );
  }
  const code = await fetchFreshCode(mailpitUrl, email, before);
  const verified = await auth('/verify', {
    method: 'POST',
    body: JSON.stringify({ type: 'email', email, token: code }),
  });
  if (verified.status !== 200 || !verified.body?.access_token) {
    throw new Error(`staff-session: the code for ${email} did not verify (${verified.status})`);
  }
  const first = verified.body.access_token;

  const enroll = await auth(
    '/factors',
    { method: 'POST', body: JSON.stringify({ factor_type: 'totp', friendly_name: 'lane' }) },
    first,
  );
  if (enroll.status !== 200 || !enroll.body?.totp?.secret) {
    throw new Error(`staff-session: TOTP enrollment for ${email} answered ${enroll.status}`);
  }
  const factorId = enroll.body.id;
  const challenge = await auth(`/factors/${factorId}/challenge`, { method: 'POST' }, first);
  const aal2 = await auth(
    `/factors/${factorId}/verify`,
    {
      method: 'POST',
      body: JSON.stringify({
        challenge_id: challenge.body?.id,
        code: totpCode(enroll.body.totp.secret),
      }),
    },
    first,
  );
  if (aal2.status !== 200 || !aal2.body?.access_token) {
    throw new Error(`staff-session: TOTP verification for ${email} answered ${aal2.status}`);
  }
  return { accessToken: aal2.body.access_token, session: aal2.body, factorId, identity };
}
