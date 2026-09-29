/** A client user's sign-in exactly as the screens drive it (WO-007): the
 * sign-in code requested through the public surface, read from the local
 * test mailbox, and entered. AAL1: a client user holds no factor. Used by
 * the lane tooling that must act AS the person (a deletion request
 * withdrawn or made on their behalf is theirs, never a privileged write).
 * Loopback only; synthetic identities only. */
import { identityFor } from './staff-session.mjs';

const LOOPBACK_HOSTS = ['127.0.0.1', 'localhost', '::1', '[::1]'];

async function fetchFreshCode(mailpitUrl, email, beforeIds, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const listing = await fetch(`${mailpitUrl}/api/v1/messages?limit=200`);
    const messages = (await listing.json().catch(() => ({}))).messages ?? [];
    const fresh = messages.find(
      (message) =>
        !beforeIds.has(message.ID) &&
        (message.To ?? []).some((to) => to.Address?.toLowerCase() === email.toLowerCase()),
    );
    if (fresh) {
      const detail = await fetch(`${mailpitUrl}/api/v1/message/${fresh.ID}`);
      const body = await detail.json().catch(() => ({}));
      const text = `${body.Text ?? ''}\n${body.HTML ?? ''}`;
      const tokens = [...new Set(text.match(/\b\d{6}\b/g) ?? [])];
      if (tokens.length === 1) return tokens[0];
      throw new Error(`client-session: the message for ${email} carries ${tokens.length} tokens`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`client-session: no sign-in code for ${email} within ${timeoutMs}ms`);
}

/** Sign `email` in with a sign-in code. Returns `{ accessToken, userId }`. */
export async function signInClientOtp({ url, clientKey, mailpitUrl, email }) {
  if (!LOOPBACK_HOSTS.includes(new URL(url).hostname)) {
    throw new Error('client-session: refusing a non-loopback URL');
  }
  const identity = identityFor(email);
  const auth = async (pathname, options = {}) => {
    const response = await fetch(`${url}/auth/v1${pathname}`, {
      ...options,
      headers: {
        apikey: clientKey,
        Authorization: `Bearer ${clientKey}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });
    return { status: response.status, body: await response.json().catch(() => ({})) };
  };
  const before = new Set(
    (
      (await (await fetch(`${mailpitUrl}/api/v1/messages?limit=200`)).json().catch(() => ({})))
        .messages ?? []
    ).map((message) => message.ID),
  );
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
      `client-session: the sign-in code request for ${email} answered ${request.status}`,
    );
  }
  const code = await fetchFreshCode(mailpitUrl, email, before);
  const verified = await auth('/verify', {
    method: 'POST',
    body: JSON.stringify({ type: 'email', email, token: code }),
  });
  if (verified.status !== 200 || !verified.body?.access_token) {
    throw new Error(`client-session: the code for ${email} did not verify (${verified.status})`);
  }
  return { accessToken: verified.body.access_token, userId: identity.id };
}
