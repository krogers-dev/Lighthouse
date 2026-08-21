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
  if (user.is_anonymous === true) {
    problems.push('user is anonymous — canonical identities are never anonymous');
  }
  const identities = Array.isArray(user.identities) ? user.identities : [];
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
    const identityEmail = emailIdentity.identity_data?.email ?? emailIdentity.email;
    if (normalizedEmail(identityEmail) !== normalizedEmail(identity.email)) {
      problems.push(
        `identity email ${identityEmail ?? '(missing)'} does not match ${identity.email}`,
      );
    }
  }
  return problems;
}
