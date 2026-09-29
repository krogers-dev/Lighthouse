-- Review tenant (WO-008, Kody's option A, decided 2026-09-29).
--
-- Store review needs to sign in without a mailbox or an authenticator.
-- The mechanism: ONE review identity (a client user of a dedicated,
-- synthetic review environment) may sign in with a fixed code, ONLY
-- while a review window is open, and the SERVER decides it. The fixed
-- code is the review identity's password, set by the operator tooling
-- when a window opens and replaced with an unknown value when it closes;
-- every password sign-in attempt on the project passes through GoTrue's
-- password-verification hook below, which rejects everyone who is not the
-- review identity, rejects the review identity outside a window, counts
-- failures and closes the window after too many, and writes an audit
-- receipt for every attempt. Email OTP and TOTP for everyone else are
-- untouched: the hook only ever runs for the password grant.
--
-- The tables live in app_private: no client role reaches them; GoTrue's
-- own database role (supabase_auth_admin) reads and updates exactly what
-- the hook needs; the server role opens and closes windows and registers
-- the review identity. Every decision here is provisional and recorded
-- in security/APPROVALS.md.

create table app_private.review_identities (
  user_id uuid primary key references auth.users (id) on delete cascade,
  environment_id uuid not null,
  client_id uuid not null,
  entity_id uuid not null,
  registered_at timestamptz not null default now(),
  foreign key (environment_id, client_id, entity_id)
    references public.entities (environment_id, client_id, id)
);

create table app_private.review_windows (
  id uuid primary key default gen_random_uuid(),
  opened_at timestamptz not null default now(),
  closes_at timestamptz not null,
  closed_at timestamptz,
  close_reason text check (close_reason in ('closed', 'too_many_failures')),
  failed_attempts integer not null default 0,
  max_failed_attempts integer not null default 10,
  idempotency_key uuid not null unique,
  close_idempotency_key uuid unique,
  check ((closed_at is null) = (close_reason is null))
);

create unique index review_windows_one_open on app_private.review_windows ((true))
  where closed_at is null;

grant usage on schema app_private to supabase_auth_admin;
-- The server role runs the registration and window functions AS itself.
grant select, insert, update, delete on app_private.review_identities to service_role;
grant select, insert, update, delete on app_private.review_windows to service_role;
grant select on app_private.review_identities to supabase_auth_admin;
grant select, update on app_private.review_windows to supabase_auth_admin;
grant execute on function app_private.append_audit(uuid, uuid, uuid, uuid, text, text, jsonb)
  to supabase_auth_admin;

/** The open window, if any: not closed, not past its close time, and not
 * exhausted by failures. */
create function app_private.current_review_window()
returns app_private.review_windows
language sql
stable
set search_path = ''
as $$
  select w.* from app_private.review_windows w
   where w.closed_at is null
     and w.closes_at > now()
     and w.failed_attempts < w.max_failed_attempts
   order by w.opened_at desc
   limit 1
$$;
revoke execute on function app_private.current_review_window() from public, anon, authenticated;
grant execute on function app_private.current_review_window() to supabase_auth_admin, service_role;

/** GoTrue's password-verification hook. Runs as supabase_auth_admin on
 * every password sign-in attempt, before GoTrue answers. The decision is
 * the server's alone. */
create function app_private.review_password_verification(event jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_user uuid;
  v_valid boolean := coalesce((event ->> 'valid')::boolean, false);
  v_identity app_private.review_identities%rowtype;
  v_window app_private.review_windows%rowtype;
  v_failures integer;
begin
  begin
    v_user := (event ->> 'user_id')::uuid;
  exception when others then
    v_user := null;
  end;
  if v_user is null then
    return jsonb_build_object('decision', 'reject',
      'message', 'Password sign-in is not available for this account.');
  end if;
  select * into v_identity from app_private.review_identities r where r.user_id = v_user;
  if not found then
    -- Not the review identity: no password sign-in exists for anyone else.
    return jsonb_build_object('decision', 'reject',
      'message', 'Password sign-in is not available for this account.');
  end if;
  select * into v_window from app_private.review_windows w
   where w.closed_at is null and w.closes_at > now()
     and w.failed_attempts < w.max_failed_attempts
   order by w.opened_at desc limit 1
   for update;
  if not found then
    perform app_private.append_audit(
      v_user, v_identity.environment_id, v_identity.client_id, v_identity.entity_id,
      'review.sign_in_refused', 'user:' || v_user::text,
      jsonb_build_object('reason', 'no_open_window'));
    return jsonb_build_object('decision', 'reject', 'message', 'The review window is closed.');
  end if;
  if not v_valid then
    v_failures := v_window.failed_attempts + 1;
    update app_private.review_windows
       set failed_attempts = v_failures,
           closed_at = case when v_failures >= max_failed_attempts then now() else closed_at end,
           close_reason = case when v_failures >= max_failed_attempts then 'too_many_failures'
                               else close_reason end
     where id = v_window.id;
    perform app_private.append_audit(
      v_user, v_identity.environment_id, v_identity.client_id, v_identity.entity_id,
      'review.sign_in_refused', 'user:' || v_user::text,
      jsonb_build_object('reason', 'invalid_code', 'window_id', v_window.id,
                         'failed_attempts', v_failures));
    return jsonb_build_object('decision', 'reject', 'message', 'That code is not right.');
  end if;
  perform app_private.append_audit(
    v_user, v_identity.environment_id, v_identity.client_id, v_identity.entity_id,
    'review.signed_in', 'user:' || v_user::text,
    jsonb_build_object('window_id', v_window.id));
  return jsonb_build_object('decision', 'continue');
end;
$$;
revoke execute on function app_private.review_password_verification(jsonb) from public, anon, authenticated;
grant execute on function app_private.review_password_verification(jsonb) to supabase_auth_admin;

/** The server role registers the one review identity (its scope is the
 * review environment's). Idempotent: registering the same user again
 * updates its scope. */
create function public.register_review_identity(
  p_user_id uuid,
  p_environment_id uuid,
  p_client_id uuid,
  p_entity_id uuid
)
returns jsonb
language plpgsql
set search_path = ''
as $$
begin
  perform app_private.require_server_role();
  if p_user_id is null then
    raise exception 'invalid_user';
  end if;
  if not exists (
    select 1 from public.memberships m
     where m.user_id = p_user_id and m.environment_id = p_environment_id
       and m.client_id = p_client_id and m.entity_id = p_entity_id and m.role = 'client_user'
  ) then
    raise exception 'not_a_client_user_of_scope';
  end if;
  insert into app_private.review_identities (user_id, environment_id, client_id, entity_id)
  values (p_user_id, p_environment_id, p_client_id, p_entity_id)
  on conflict (user_id) do update
    set environment_id = excluded.environment_id, client_id = excluded.client_id,
        entity_id = excluded.entity_id;
  perform app_private.append_audit(
    null, p_environment_id, p_client_id, p_entity_id,
    'review.identity_registered', 'user:' || p_user_id::text, '{}'::jsonb);
  return jsonb_build_object('user_id', p_user_id, 'registered', true);
end;
$$;
revoke execute on function public.register_review_identity(uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.register_review_identity(uuid, uuid, uuid, uuid) to service_role;

create function public.unregister_review_identity(p_user_id uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_identity app_private.review_identities%rowtype;
begin
  perform app_private.require_server_role();
  select * into v_identity from app_private.review_identities r where r.user_id = p_user_id;
  if not found then
    return jsonb_build_object('user_id', p_user_id, 'registered', false);
  end if;
  delete from app_private.review_identities where user_id = p_user_id;
  perform app_private.append_audit(
    null, v_identity.environment_id, v_identity.client_id, v_identity.entity_id,
    'review.identity_unregistered', 'user:' || p_user_id::text, '{}'::jsonb);
  return jsonb_build_object('user_id', p_user_id, 'registered', false);
end;
$$;
revoke execute on function public.unregister_review_identity(uuid) from public, anon, authenticated;
grant execute on function public.unregister_review_identity(uuid) to service_role;

/** Opens a review window for up to seven days. One open window at a time;
 * the same key replays the same window; one audit receipt in the review
 * identity's scope. */
create function public.open_review_window(p_hours integer, p_idempotency_key uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_existing app_private.review_windows%rowtype;
  v_open app_private.review_windows%rowtype;
  v_identity app_private.review_identities%rowtype;
  v_id uuid;
  v_now timestamptz := now();
begin
  perform app_private.require_server_role();
  if p_idempotency_key is null then
    raise exception 'invalid_idempotency_key';
  end if;
  select * into v_existing from app_private.review_windows w where w.idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('window_id', v_existing.id, 'closes_at', v_existing.closes_at,
                              'replayed', true);
  end if;
  if p_hours is null or p_hours < 1 or p_hours > 168 then
    raise exception 'invalid_hours';
  end if;
  select * into v_identity from app_private.review_identities limit 1;
  if not found then
    raise exception 'no_review_identity';
  end if;
  select * into v_open from app_private.review_windows w where w.closed_at is null;
  if found then
    raise exception 'window_already_open';
  end if;
  v_id := gen_random_uuid();
  insert into app_private.review_windows (id, opened_at, closes_at, idempotency_key)
  values (v_id, v_now, v_now + make_interval(hours => p_hours), p_idempotency_key);
  perform app_private.append_audit(
    null, v_identity.environment_id, v_identity.client_id, v_identity.entity_id,
    'review.window_opened', 'window:' || v_id::text,
    jsonb_build_object('closes_at', v_now + make_interval(hours => p_hours),
                       'idempotency_key', p_idempotency_key));
  return jsonb_build_object('window_id', v_id, 'closes_at', v_now + make_interval(hours => p_hours),
                            'replayed', false);
end;
$$;
revoke execute on function public.open_review_window(integer, uuid) from public, anon, authenticated;
grant execute on function public.open_review_window(integer, uuid) to service_role;

/** Closes the open window. The same key replays; no open window is a
 * refusal. */
create function public.close_review_window(p_idempotency_key uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_replayed app_private.review_windows%rowtype;
  v_open app_private.review_windows%rowtype;
  v_identity app_private.review_identities%rowtype;
  v_now timestamptz := now();
begin
  perform app_private.require_server_role();
  if p_idempotency_key is null then
    raise exception 'invalid_idempotency_key';
  end if;
  select * into v_replayed from app_private.review_windows w
   where w.close_idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('window_id', v_replayed.id, 'closed_at', v_replayed.closed_at,
                              'replayed', true);
  end if;
  select * into v_open from app_private.review_windows w where w.closed_at is null for update;
  if not found then
    raise exception 'no_open_window';
  end if;
  update app_private.review_windows
     set closed_at = v_now, close_reason = 'closed', close_idempotency_key = p_idempotency_key
   where id = v_open.id;
  select * into v_identity from app_private.review_identities limit 1;
  if found then
    perform app_private.append_audit(
      null, v_identity.environment_id, v_identity.client_id, v_identity.entity_id,
      'review.window_closed', 'window:' || v_open.id::text,
      jsonb_build_object('failed_attempts', v_open.failed_attempts,
                         'idempotency_key', p_idempotency_key));
  end if;
  return jsonb_build_object('window_id', v_open.id, 'closed_at', v_now, 'replayed', false);
end;
$$;
revoke execute on function public.close_review_window(uuid) from public, anon, authenticated;
grant execute on function public.close_review_window(uuid) to service_role;

/** The window as the tooling reads it. */
create function public.review_window_status()
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_window app_private.review_windows;
begin
  perform app_private.require_server_role();
  v_window := app_private.current_review_window();
  if v_window.id is null then
    return jsonb_build_object('open', false,
      'review_identities', (select count(*) from app_private.review_identities));
  end if;
  return jsonb_build_object('open', true, 'window_id', v_window.id, 'opened_at', v_window.opened_at,
    'closes_at', v_window.closes_at, 'failed_attempts', v_window.failed_attempts,
    'max_failed_attempts', v_window.max_failed_attempts,
    'review_identities', (select count(*) from app_private.review_identities));
end;
$$;
revoke execute on function public.review_window_status() from public, anon, authenticated;
grant execute on function public.review_window_status() to service_role;
