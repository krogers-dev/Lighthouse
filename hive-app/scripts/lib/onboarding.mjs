/** Onboarding from the operator's side (WO-012): what an address, a name,
 * a role, and an id must look like before anything is sent to a server,
 * and what each lane allows. Pure and unit-tested
 * (tests/scripts/onboarding.test.mjs); nothing here touches the network.
 *
 * The server checks the same things again (supabase/migrations/
 * 20260930120015_onboarding.sql); these checks exist so that a slip is
 * refused on the operator's machine, in words, before a key is read. */

export const ROLES = ['client_user', 'intake', 'preparer', 'reviewer', 'approver'];
export const STAFF_ROLES = ROLES.filter((role) => role !== 'client_user');

const ADDRESS = /^[a-z0-9][a-z0-9._+-]*@([a-z0-9-]+(?:\.[a-z0-9-]+)+)$/;
// Domains that can never receive a sign-in code: the reserved top-level
// names and the documentation domains.
const RESERVED_DOMAIN = /(?:^|\.)(?:invalid|example|test|localhost)$|^example\.(?:com|net|org)$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The local stack: the seeded environment, synthetic addresses for every
 * role. */
export const LOCAL_ONBOARDING_RULES = Object.freeze({
  environment: Object.freeze({ name: 'local-development', kind: 'development' }),
  staffEmailDomains: Object.freeze(['example.invalid']),
  allowSyntheticAddresses: true,
});

/** What the lane allows: a hosted target's entry in
 * security/hosted-targets.json, or the local rules. */
export function onboardingRulesFor(context) {
  if (context?.kind === 'hosted' && context.target) {
    return {
      environment: context.target.environment,
      staffEmailDomains: context.target.staffEmailDomains,
      allowSyntheticAddresses: context.target.allowSyntheticAddresses === true,
    };
  }
  return LOCAL_ONBOARDING_RULES;
}

/** Lower-cased and trimmed, or null when it is not an address. */
export function normalizeEmail(value) {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  return ADDRESS.test(email) ? email : null;
}

/** Null when this address may be given this role in this lane; otherwise
 * why not, in words that never repeat more than the rule. */
export function emailProblem(value, role, rules) {
  if (!ROLES.includes(role)) return `the role must be one of: ${ROLES.join(', ')}`;
  const email = normalizeEmail(value);
  if (!email) return 'that is not an email address';
  const domain = ADDRESS.exec(email)[1];
  if (RESERVED_DOMAIN.test(domain) && !rules.allowSyntheticAddresses) {
    return 'a reserved or test address cannot receive a sign-in code on this project';
  }
  if (STAFF_ROLES.includes(role) && !rules.staffEmailDomains.includes(domain)) {
    return `staff roles are given only to addresses on: ${rules.staffEmailDomains.join(', ')}`;
  }
  return null;
}

/** An address as the tooling shows it: the first character and the
 * domain. A whole address is never printed. */
export function maskEmail(value) {
  const email = normalizeEmail(value);
  if (!email) return '(no address)';
  const at = email.indexOf('@');
  return `${email[0]}***${email.slice(at)}`;
}

function hasControlCharacter(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

/** Mirrors the server's display-name rule for early, worded refusal. */
export function nameProblem(value) {
  if (typeof value !== 'string') return 'a name is required';
  if (hasControlCharacter(value)) return 'a name is one line, with no control characters';
  const cleaned = value.replace(/ +/g, ' ').trim();
  if (cleaned.length < 2 || cleaned.length > 120) return 'a name is two to 120 characters';
  return null;
}

export function isUuid(value) {
  return typeof value === 'string' && UUID.test(value);
}

/** The values a command will send, or every reason it cannot be sent. */
export function parseOnboardingCommand(command, args, rules) {
  const list = Array.isArray(args) ? args : [];
  const problems = [];
  if (command === 'onboard-entity') {
    if (list.length !== 2) {
      return { problems: ['onboard-entity takes a client name and an entity name'], values: null };
    }
    const [clientName, entityName] = list;
    for (const [label, name] of [
      ['client', clientName],
      ['entity', entityName],
    ]) {
      const problem = nameProblem(name);
      if (problem) problems.push(`the ${label} name: ${problem}`);
    }
    return {
      problems,
      values: problems.length
        ? null
        : {
            environmentName: rules.environment.name,
            environmentKind: rules.environment.kind,
            clientName,
            entityName,
          },
    };
  }
  if (command === 'invite' || command === 'revoke-access') {
    if (list.length !== 3) {
      return { problems: [`${command} takes an address, a role, and an entity id`], values: null };
    }
    const [address, role, entityId] = list;
    const problem = emailProblem(address, role, rules);
    if (problem) problems.push(problem);
    if (!isUuid(entityId)) problems.push('the entity id is not an id');
    return {
      problems,
      values: problems.length ? null : { email: normalizeEmail(address), role, entityId },
    };
  }
  if (command === 'list-entities') {
    return list.length === 0
      ? { problems: [], values: {} }
      : { problems: ['list-entities takes no arguments'], values: null };
  }
  if (command === 'list-access') {
    return list.length === 1 && isUuid(list[0])
      ? { problems: [], values: { entityId: list[0] } }
      : { problems: ['list-access takes one entity id'], values: null };
  }
  return { problems: [`"${String(command)}" is not an onboarding command`], values: null };
}
