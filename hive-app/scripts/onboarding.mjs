#!/usr/bin/env node
/**
 * onboarding — a client, a legal entity, and the people who may see them
 * (WO-012).
 *
 *   node scripts/local-supabase.mjs onboard-entity "<client name>" "<entity name>"
 *   node scripts/local-supabase.mjs invite <address> <role> <entity id>
 *   node scripts/local-supabase.mjs revoke-access <address> <role> <entity id>
 *   node scripts/local-supabase.mjs list-entities
 *   node scripts/local-supabase.mjs list-access <entity id>
 *   node scripts/hosted-supabase.mjs <staging|production> <the same five commands>
 *
 * onboard-entity  Brings a legal entity into the lane's environment under
 *                 a client: the client is found by name or created, the
 *                 entity must be new. Prints the ids the other commands
 *                 take.
 *
 * invite          Gives one person one role on one entity. The person is
 *                 found by address or created through the Auth Admin API,
 *                 confirmed, with no password: they sign in by emailed
 *                 code, and staff enroll an authenticator at their first
 *                 sign-in. No email is sent by an invitation. A staff role
 *                 goes only to an address on the lane's staff domains.
 *
 * revoke-access   Removes that one role on that one entity. Access ends at
 *                 once: every read re-checks membership.
 *
 * list-entities   The environments, clients, and entities, with their ids.
 *
 * list-access     Who holds which role on one entity. Addresses are shown
 *                 masked.
 *
 * The roles are client_user, intake, preparer, reviewer, approver. The
 * stack is the loopback one, or one of the two hosted projects named in
 * security/hosted-targets.json: scripts/lib/operator-context.mjs decides,
 * and a change on production needs its project ref repeated. Every change
 * goes through a reviewed server-role function that writes an audit
 * receipt. The privileged key arrives in memory and is never printed, and
 * no whole address is ever printed.
 */
import { randomUUID } from 'node:crypto';
import process from 'node:process';

import { loadHostedManifest } from './lib/hosted-targets.mjs';
import { maskEmail, onboardingRulesFor, parseOnboardingCommand } from './lib/onboarding.mjs';
import { changeRefusal, resolveOperatorContext } from './lib/operator-context.mjs';

function fail(message) {
  console.error(`onboarding: ${message}`);
  process.exit(1);
}

const command = process.env.HIVE_ONBOARD_COMMAND ?? '';
let args;
try {
  args = JSON.parse(process.env.HIVE_ONBOARD_ARGS ?? '[]');
} catch {
  fail('the arguments were not handed over as a list; run through a runner');
}

const context = resolveOperatorContext(process.env, loadHostedManifest());
if (context.error) fail(context.error);
const parsed = parseOnboardingCommand(command, args, onboardingRulesFor(context));
if (parsed.problems.length > 0) fail(parsed.problems.join('; '));
const refusal = changeRefusal(context, command);
if (refusal) fail(refusal);

const { url, serviceKey, gatewayKey } = context;
const where = context.kind === 'hosted' ? ` [${context.name}]` : '';
const headers = {
  apikey: gatewayKey,
  Authorization: `Bearer ${serviceKey}`,
  'Content-Type': 'application/json',
};

async function call(pathname, options = {}) {
  const response = await fetch(`${url}${pathname}`, {
    ...options,
    headers: { ...headers, ...options.headers },
  });
  const text = await response.text();
  let body = null;
  try {
    body = text === '' ? null : JSON.parse(text);
  } catch {
    body = null;
  }
  return { ok: response.ok, status: response.status, body };
}

const rpc = (name, body) =>
  call(`/rest/v1/rpc/${name}`, { method: 'POST', body: JSON.stringify(body) });

/** A refusal token from a server function, or the status when there is
 * none. Never the body. */
function refusalOf(result) {
  const message = typeof result.body?.message === 'string' ? result.body.message : '';
  return /^[a-z_]{3,40}$/.test(message) ? message : `status ${result.status}`;
}

async function scopeOf(entityId) {
  const found = await call(
    `/rest/v1/entities?select=id,environment_id,client_id,display_name&id=eq.${entityId}`,
  );
  if (!found.ok) fail(`the entity could not be read (${found.status})`);
  const row = (found.body ?? [])[0];
  if (!row) fail('no entity has that id on this project');
  return row;
}

if (command === 'onboard-entity') {
  const v = parsed.values;
  const result = await rpc('onboard_entity', {
    p_environment_name: v.environmentName,
    p_environment_kind: v.environmentKind,
    p_client_name: v.clientName,
    p_entity_name: v.entityName,
    p_idempotency_key: randomUUID(),
  });
  if (!result.ok) fail(`the entity was not onboarded (${refusalOf(result)})`);
  const r = result.body;
  console.log(
    `onboarding${where}: entity ${r.entity_id} onboarded under client ${r.client_id} (${
      r.client_created ? 'client created' : 'existing client'
    }) in environment ${v.environmentName} (${
      r.environment_created ? 'created' : 'existing'
    }); give people access with: invite <address> <role> ${r.entity_id}`,
  );
  process.exit(0);
}

if (command === 'invite') {
  const v = parsed.values;
  const scope = await scopeOf(v.entityId);
  const lookup = await rpc('operator_user_id_by_email', { p_email: v.email });
  if (!lookup.ok) fail(`the address could not be looked up (${lookup.status})`);
  let userId = typeof lookup.body === 'string' ? lookup.body : null;
  let identity = 'existing identity';
  if (!userId) {
    // Through GoTrue, never by SQL: confirmed, no password, no email sent.
    const created = await call('/auth/v1/admin/users', {
      method: 'POST',
      body: JSON.stringify({ email: v.email, email_confirm: true }),
    });
    if (!created.ok || typeof created.body?.id !== 'string') {
      fail(`the identity could not be created (${created.status})`);
    }
    userId = created.body.id;
    identity = 'identity created';
  }
  const granted = await rpc('grant_membership', {
    p_user_id: userId,
    p_environment_id: scope.environment_id,
    p_client_id: scope.client_id,
    p_entity_id: scope.id,
    p_role: v.role,
    p_idempotency_key: randomUUID(),
  });
  if (!granted.ok) fail(`the membership was not granted (${refusalOf(granted)})`);
  console.log(
    `onboarding${where}: ${maskEmail(v.email)} (${userId}) holds ${v.role} on entity ${scope.id}; ${identity}; ${
      granted.body.granted ? 'membership granted' : 'membership already held'
    }; no email was sent: they sign in with a code when they open the app`,
  );
  process.exit(0);
}

if (command === 'revoke-access') {
  const v = parsed.values;
  const scope = await scopeOf(v.entityId);
  const lookup = await rpc('operator_user_id_by_email', { p_email: v.email });
  if (!lookup.ok) fail(`the address could not be looked up (${lookup.status})`);
  if (typeof lookup.body !== 'string') fail('nobody on this project has that address');
  const revoked = await rpc('revoke_membership', {
    p_user_id: lookup.body,
    p_environment_id: scope.environment_id,
    p_client_id: scope.client_id,
    p_entity_id: scope.id,
    p_role: v.role,
    p_idempotency_key: randomUUID(),
  });
  if (!revoked.ok) fail(`the membership was not revoked (${refusalOf(revoked)})`);
  console.log(
    `onboarding${where}: ${maskEmail(v.email)} (${lookup.body}) ${
      revoked.body.revoked ? 'no longer holds' : 'did not hold'
    } ${v.role} on entity ${scope.id}`,
  );
  process.exit(0);
}

if (command === 'list-entities') {
  const environments = await call('/rest/v1/environments?select=id,name,kind&order=name');
  const clients = await call(
    '/rest/v1/clients?select=id,environment_id,display_name&order=display_name',
  );
  const entities = await call(
    '/rest/v1/entities?select=id,environment_id,client_id,display_name&order=display_name',
  );
  if (!environments.ok || !clients.ok || !entities.ok) {
    fail(
      `the scope tables could not be read (${environments.status}, ${clients.status}, ${entities.status})`,
    );
  }
  console.log(
    `onboarding${where}: ${environments.body.length} environment(s), ${clients.body.length} client(s), ${entities.body.length} entit(ies)`,
  );
  for (const environment of environments.body) {
    console.log(`  environment ${environment.name} (${environment.kind})`);
    for (const client of clients.body.filter((c) => c.environment_id === environment.id)) {
      console.log(`    client ${client.display_name}  ${client.id}`);
      for (const entity of entities.body.filter((e) => e.client_id === client.id)) {
        console.log(`      entity ${entity.display_name}  ${entity.id}`);
      }
    }
  }
  process.exit(0);
}

// list-access
const scope = await scopeOf(parsed.values.entityId);
const members = await call(
  `/rest/v1/memberships?select=user_id,role&entity_id=eq.${scope.id}&order=role`,
);
if (!members.ok) fail(`the memberships could not be read (${members.status})`);
console.log(`onboarding${where}: ${members.body.length} membership(s) on entity ${scope.id}`);
for (const member of members.body) {
  const identity = await call(`/auth/v1/admin/users/${member.user_id}`);
  const shown = identity.ok ? maskEmail(identity.body?.email) : '(identity not readable)';
  console.log(`  ${member.role.padEnd(11)} ${shown}  ${member.user_id}`);
}
process.exit(0);
