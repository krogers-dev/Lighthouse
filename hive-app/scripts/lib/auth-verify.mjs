/** Canonical Auth identity verification (second RETURN directive, area 1).
 *
 * Pure and unit-tested (tests/scripts/auth-verify.test.mjs). Compares a
 * live GoTrue admin-API user object against a canonical synthetic identity
 * definition. Every check is exact and fail-closed: the seed and e2e
 * harnesses treat ANY returned problem as a hard failure — an existing
 * user under the right email with the wrong UUID must never be adopted.
 */

function normalizedEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

/** Returns a list of human-readable problems; empty means verified. */
export function verifyCanonicalUser(user, identity) {
  const problems = [];
  if (typeof user !== 'object' || user === null) {
    return ['user payload is not an object'];
  }
  if (user.id !== identity.id) {
    problems.push(
      `user id ${user.id ?? '(missing)'} does not equal the canonical id ${identity.id}`,
    );
  }
  if (normalizedEmail(user.email) !== normalizedEmail(identity.email)) {
    problems.push(`email ${user.email ?? '(missing)'} does not match ${identity.email}`);
  }
  // email_confirmed_at SPECIFICALLY (RETURN-3 area 4): the generic
  // confirmed_at can represent phone confirmation and proves nothing
  // about the email factor this identity signs in with.
  if (!user.email_confirmed_at) {
    problems.push('email_confirmed_at is not set — the email itself is not confirmed');
  }
  if (user.role !== 'authenticated') {
    problems.push(`role ${JSON.stringify(user.role)} is not exactly "authenticated"`);
  }
  if (user.aud !== 'authenticated') {
    problems.push(`aud ${JSON.stringify(user.aud)} is not exactly "authenticated"`);
  }
  // Explicitly REQUIRED false (RETURN-4 P2-5): a missing field is not a
  // negative answer. An older GoTrue payload without is_anonymous, or a
  // trimmed one, must not read as "not anonymous" by omission.
  if (user.is_anonymous !== false) {
    problems.push(
      `is_anonymous is ${JSON.stringify(user.is_anonymous)} — canonical identities must state exactly false`,
    );
  }
  // RETURN-4 P2-5: the TOTAL identity count is what matters. Filtering to
  // email identities first accepted a user who also carried a phone or
  // OAuth identity — an additional sign-in path into the same canonical
  // account, which is exactly what must not exist.
  const identities = Array.isArray(user.identities) ? user.identities : [];
  if (identities.length !== 1) {
    problems.push(
      `expected exactly one identity in total, found ${identities.length} (${
        identities.map((entry) => entry?.provider ?? '(no provider)').join(', ') || 'none'
      }) — an extra identity is an extra sign-in path`,
    );
  }
  const emailIdentities = identities.filter((entry) => entry?.provider === 'email');
  if (emailIdentities.length !== 1) {
    problems.push(`expected exactly one email identity, found ${emailIdentities.length}`);
  } else {
    const emailIdentity = emailIdentities[0];
    if (emailIdentity.user_id !== identity.id) {
      problems.push(
        `identity user_id ${emailIdentity.user_id ?? '(missing)'} does not equal the canonical id ${identity.id}`,
      );
    }
    // The email provider's identity id IS the user id in GoTrue, and
    // identity_data.sub is the binding the token subject is derived from:
    // a mutated sub points the identity at a different account.
    if (emailIdentity.id !== identity.id) {
      problems.push(
        `email identity id ${emailIdentity.id ?? '(missing)'} does not equal the canonical id ${identity.id} (the email provider id is the user id)`,
      );
    }
    if (emailIdentity.identity_data?.sub !== identity.id) {
      problems.push(
        `identity_data.sub ${emailIdentity.identity_data?.sub ?? '(missing)'} does not equal the canonical id ${identity.id}`,
      );
    }
    const identityEmail = emailIdentity.identity_data?.email ?? emailIdentity.email;
    if (normalizedEmail(identityEmail) !== normalizedEmail(identity.email)) {
      problems.push(
        `identity email ${identityEmail ?? '(missing)'} does not match ${identity.email}`,
      );
    }
  }
  // Canonical provider metadata: the account signs in by email and ONLY
  // by email.
  const appMetadata = user.app_metadata ?? {};
  if (appMetadata.provider !== 'email') {
    problems.push(
      `app_metadata.provider ${JSON.stringify(appMetadata.provider)} is not exactly "email"`,
    );
  }
  const providers = Array.isArray(appMetadata.providers) ? appMetadata.providers : null;
  if (providers === null || providers.length !== 1 || providers[0] !== 'email') {
    problems.push(
      `app_metadata.providers ${JSON.stringify(appMetadata.providers)} is not exactly ["email"]`,
    );
  }
  return problems;
}
