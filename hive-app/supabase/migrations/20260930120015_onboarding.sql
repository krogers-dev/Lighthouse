-- Onboarding (WO-012): how a client, a legal entity, and the people who may
-- see them come to exist outside the synthetic seed.
--
-- Until now only the seed created an environment, a client, an entity, or a
-- membership. A hosted project has no seed, so nothing could be given to
-- anyone. These are the reviewed server-role functions the operator tooling
-- calls (scripts/onboarding.mjs through the local and hosted runners):
--
--   onboard_entity            an environment (found by name or created), a
--                             client (found by name or created), and a new
--                             entity under it
--   grant_membership          one person, one exact scope, one role
--   revoke_membership         the same, removed; access ends at once,
--                             because every read re-checks membership
--   operator_user_id_by_email the person an address belongs to, if any
--
-- Membership is the only source of scope authority, so nothing here is
-- reachable by a client role: the functions run as the server role alone,
-- every change writes an audit receipt in the scope it touches, and the
-- same idempotency key never writes twice. Identities themselves are
-- created through the Auth Admin API by the tooling, never by SQL: a row
-- inserted into auth.users by hand is one GoTrue cannot load.
--
-- Every decision is provisional and recorded in security/APPROVALS.md.

-- ---------------------------------------------------------------------------
-- One name, one client; one name, one entity of a client. Compared without
-- regard to case; the functions below store names trimmed and single-spaced.
-- ---------------------------------------------------------------------------
create unique index clients_environment_name_key
  on public.clients (environment_id, lower(display_name));
create unique index entities_client_name_key
  on public.entities (environment_id, client_id, lower(display_name));

-- ---------------------------------------------------------------------------
-- Helpers (app_private, no API).
-- ---------------------------------------------------------------------------

/** A display name as it is stored: trimmed, inner whitespace single-spaced.
 * Null when it is not acceptable: shorter than two or longer than 120
 * characters, or carrying a control character or a line break. */
create function app_private.clean_display_name(p_name text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_name text;
begin
  if p_name is null or p_name ~ E'[\\x01-\\x1F\\x7F]' then
    return null;
  end if;
  v_name := btrim(regexp_replace(p_name, ' +', ' ', 'g'));
  if char_length(v_name) < 2 or char_length(v_name) > 120 then
    return null;
  end if;
  return v_name;
end;
$$;
revoke execute on function app_private.clean_display_name(text) from public, anon, authenticated;
grant execute on function app_private.clean_display_name(text) to service_role;

/** The identity table is GoTrue's; the server role reads it only through
 * these two, which run with the owner's rights and return an id or a fact,
 * never a row. */
create function app_private.user_id_by_email(p_email text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select u.id from auth.users u where lower(u.email) = lower(btrim(p_email)) limit 1
$$;
revoke execute on function app_private.user_id_by_email(text) from public, anon, authenticated;
grant execute on function app_private.user_id_by_email(text) to service_role;

create function app_private.auth_user_exists(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from auth.users u where u.id = p_user_id)
$$;
revoke execute on function app_private.auth_user_exists(uuid) from public, anon, authenticated;
grant execute on function app_private.auth_user_exists(uuid) to service_role;

/** A completed operator change's own result, when the same key is sent
 * again: the receipt is the record, so a lost answer never writes twice. */
create function app_private.operator_replay(p_action text, p_key uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select r.details -> 'result'
    from public.audit_receipts r
   where r.action = p_action
     and r.actor_user_id is null
     and r.details ->> 'idempotency_key' = p_key::text
   order by r.occurred_at desc
   limit 1
$$;
revoke execute on function app_private.operator_replay(text, uuid) from public, anon, authenticated;
grant execute on function app_private.operator_replay(text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- The functions. Run AS the server role (not security definer:
-- require_server_role reads current_user). Refusals are stable tokens.
-- ---------------------------------------------------------------------------

create function public.onboard_entity(
  p_environment_name text,
  p_environment_kind text,
  p_client_name text,
  p_entity_name text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_replay jsonb;
  v_environment_name text;
  v_client_name text := app_private.clean_display_name(p_client_name);
  v_entity_name text := app_private.clean_display_name(p_entity_name);
  v_environment public.environments%rowtype;
  v_environment_created boolean := false;
  v_client_id uuid;
  v_client_created boolean := false;
  v_entity_id uuid;
  v_result jsonb;
begin
  perform app_private.require_server_role();
  if p_idempotency_key is null then
    raise exception 'invalid_idempotency_key';
  end if;
  v_replay := app_private.operator_replay('entity.onboarded', p_idempotency_key);
  if v_replay is not null then
    return v_replay || jsonb_build_object('replayed', true);
  end if;
  if p_environment_kind is null
     or p_environment_kind not in ('development', 'staging', 'production') then
    raise exception 'invalid_kind';
  end if;
  -- An environment's name is a short machine label, not a display name.
  v_environment_name := lower(btrim(coalesce(p_environment_name, '')));
  if v_environment_name !~ '^[a-z][a-z0-9-]{1,39}$' then
    raise exception 'invalid_name';
  end if;
  if v_client_name is null or v_entity_name is null then
    raise exception 'invalid_name';
  end if;

  select * into v_environment from public.environments e where e.name = v_environment_name;
  if found then
    if v_environment.kind <> p_environment_kind then
      raise exception 'environment_kind_mismatch';
    end if;
  else
    insert into public.environments (id, name, kind)
    values (gen_random_uuid(), v_environment_name, p_environment_kind)
    returning * into v_environment;
    v_environment_created := true;
  end if;

  select c.id into v_client_id
    from public.clients c
   where c.environment_id = v_environment.id and lower(c.display_name) = lower(v_client_name);
  if not found then
    v_client_id := gen_random_uuid();
    insert into public.clients (id, environment_id, display_name)
    values (v_client_id, v_environment.id, v_client_name);
    v_client_created := true;
  end if;

  if exists (
    select 1 from public.entities e
     where e.environment_id = v_environment.id and e.client_id = v_client_id
       and lower(e.display_name) = lower(v_entity_name)
  ) then
    raise exception 'entity_exists';
  end if;
  v_entity_id := gen_random_uuid();
  insert into public.entities (id, environment_id, client_id, display_name)
  values (v_entity_id, v_environment.id, v_client_id, v_entity_name);

  -- Ids and facts only: the names live in their own rows, not in receipts.
  v_result := jsonb_build_object(
    'environment_id', v_environment.id,
    'client_id', v_client_id,
    'entity_id', v_entity_id,
    'environment_created', v_environment_created,
    'client_created', v_client_created,
    'replayed', false
  );
  perform app_private.append_audit(
    null, v_environment.id, v_client_id, v_entity_id,
    'entity.onboarded', 'entity:' || v_entity_id::text,
    jsonb_build_object('idempotency_key', p_idempotency_key, 'result', v_result));
  return v_result;
end;
$$;
revoke execute on function public.onboard_entity(text, text, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.onboard_entity(text, text, text, text, uuid) to service_role;

create function public.grant_membership(
  p_user_id uuid,
  p_environment_id uuid,
  p_client_id uuid,
  p_entity_id uuid,
  p_role text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_replay jsonb;
  v_inserted integer;
  v_result jsonb;
begin
  perform app_private.require_server_role();
  if p_idempotency_key is null then
    raise exception 'invalid_idempotency_key';
  end if;
  v_replay := app_private.operator_replay('membership.granted', p_idempotency_key);
  if v_replay is not null then
    return v_replay || jsonb_build_object('replayed', true);
  end if;
  if p_role is null
     or p_role not in ('client_user', 'intake', 'preparer', 'reviewer', 'approver') then
    raise exception 'invalid_role';
  end if;
  if p_user_id is null or not app_private.auth_user_exists(p_user_id) then
    raise exception 'unknown_user';
  end if;
  if not exists (
    select 1 from public.entities e
     where e.environment_id = p_environment_id and e.client_id = p_client_id
       and e.id = p_entity_id
  ) then
    raise exception 'unknown_scope';
  end if;

  insert into public.memberships (user_id, environment_id, client_id, entity_id, role)
  values (p_user_id, p_environment_id, p_client_id, p_entity_id, p_role)
  on conflict (user_id, environment_id, client_id, entity_id, role) do nothing;
  get diagnostics v_inserted = row_count;

  v_result := jsonb_build_object(
    'user_id', p_user_id, 'role', p_role,
    'granted', v_inserted = 1, 'already_held', v_inserted = 0, 'replayed', false);
  perform app_private.append_audit(
    null, p_environment_id, p_client_id, p_entity_id,
    'membership.granted', 'user:' || p_user_id::text,
    jsonb_build_object('idempotency_key', p_idempotency_key, 'role', p_role,
                       'result', v_result));
  return v_result;
end;
$$;
revoke execute on function public.grant_membership(uuid, uuid, uuid, uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.grant_membership(uuid, uuid, uuid, uuid, text, uuid)
  to service_role;

create function public.revoke_membership(
  p_user_id uuid,
  p_environment_id uuid,
  p_client_id uuid,
  p_entity_id uuid,
  p_role text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_replay jsonb;
  v_removed integer;
  v_result jsonb;
begin
  perform app_private.require_server_role();
  if p_idempotency_key is null then
    raise exception 'invalid_idempotency_key';
  end if;
  v_replay := app_private.operator_replay('membership.revoked', p_idempotency_key);
  if v_replay is not null then
    return v_replay || jsonb_build_object('replayed', true);
  end if;
  if p_role is null
     or p_role not in ('client_user', 'intake', 'preparer', 'reviewer', 'approver') then
    raise exception 'invalid_role';
  end if;
  if not exists (
    select 1 from public.entities e
     where e.environment_id = p_environment_id and e.client_id = p_client_id
       and e.id = p_entity_id
  ) then
    raise exception 'unknown_scope';
  end if;

  delete from public.memberships m
   where m.user_id = p_user_id and m.environment_id = p_environment_id
     and m.client_id = p_client_id and m.entity_id = p_entity_id and m.role = p_role;
  get diagnostics v_removed = row_count;

  v_result := jsonb_build_object(
    'user_id', p_user_id, 'role', p_role, 'revoked', v_removed = 1, 'replayed', false);
  perform app_private.append_audit(
    null, p_environment_id, p_client_id, p_entity_id,
    'membership.revoked', 'user:' || p_user_id::text,
    jsonb_build_object('idempotency_key', p_idempotency_key, 'role', p_role,
                       'result', v_result));
  return v_result;
end;
$$;
revoke execute on function public.revoke_membership(uuid, uuid, uuid, uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.revoke_membership(uuid, uuid, uuid, uuid, text, uuid)
  to service_role;

create function public.operator_user_id_by_email(p_email text)
returns uuid
language plpgsql
stable
set search_path = ''
as $$
begin
  perform app_private.require_server_role();
  if p_email is null or btrim(p_email) = '' then
    return null;
  end if;
  return app_private.user_id_by_email(p_email);
end;
$$;
revoke execute on function public.operator_user_id_by_email(text) from public, anon, authenticated;
grant execute on function public.operator_user_id_by_email(text) to service_role;
