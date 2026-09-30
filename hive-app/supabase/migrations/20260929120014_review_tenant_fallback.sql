-- Review tenant fallback (WO-009, Kody's choice of 2026-09-29: "Go with the
-- fallback, build it now").
--
-- The hosted platform offers GoTrue's password-verification hook only on
-- its Teams and Enterprise plans; below them the hook of WO-008 never
-- runs, and the platform even refuses to be told about it. So the server
-- keeps the same rules by other means, none of which needs the hook:
--
--   1. Nobody but the review identity, and only inside an open window,
--      holds a usable password. A trigger on auth.users replaces any other
--      password hash the moment it is written, whoever writes it: a user
--      setting a password for their own account, an operator, anyone.
--   2. A window ends at its close time even when nobody closes it. A
--      scheduled sweep (pg_cron, every minute, where the extension exists)
--      closes expired windows, replaces the review identity's hash, and
--      revokes its sessions; it also scrubs any hash that predates the
--      trigger, once.
--   3. Closing a window, and retiring the identity, revoke the identity's
--      sessions and replace its hash on the server, not only through the
--      tooling's Auth Admin call.
--
-- What the hook gave and this cannot: counting wrong codes and closing the
-- window after ten. GoTrue's sign-in rate limit (thirty attempts per five
-- minutes per address) and the code's twelve to twenty digits stand in,
-- and the window's own close time bounds the exposure. The hook stays
-- defined for the day the plan permits it; nothing here conflicts with it.
-- Every decision is provisional and recorded in security/APPROVALS.md.

-- ---------------------------------------------------------------------------
-- A window can now close because it expired.
-- ---------------------------------------------------------------------------
alter table app_private.review_windows drop constraint if exists review_windows_close_reason_check;
alter table app_private.review_windows
  add constraint review_windows_close_reason_check
  check (close_reason in ('closed', 'too_many_failures', 'expired'));

-- ---------------------------------------------------------------------------
-- What the sweep records.
-- ---------------------------------------------------------------------------
create table app_private.password_scrubs (
  user_id uuid primary key references auth.users (id) on delete cascade,
  hash_digest text not null,
  scrubbed_at timestamptz not null default now(),
  scrub_count integer not null default 1
);
grant select on app_private.password_scrubs to service_role;

create table app_private.review_sweep_state (
  id boolean primary key default true check (id),
  last_run_at timestamptz,
  last_expired integer not null default 0,
  last_scrubbed integer not null default 0,
  total_expired integer not null default 0,
  total_scrubbed integer not null default 0
);
insert into app_private.review_sweep_state (id) values (true);
grant select on app_private.review_sweep_state to service_role;

-- ---------------------------------------------------------------------------
-- A hash nobody knows the password for.
-- ---------------------------------------------------------------------------
create function app_private.scrambled_password_hash()
returns text
language sql
volatile
set search_path = ''
as $$
  select extensions.crypt(encode(extensions.gen_random_bytes(32), 'hex'), extensions.gen_salt('bf'))
$$;
revoke execute on function app_private.scrambled_password_hash() from public, anon, authenticated;

/** Whether this user is the review identity and a window is open right
 * now, the only state in which a password of theirs may stand. */
create function app_private.review_identity_in_open_window(p_user_id uuid, p_as_of timestamptz)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
      from app_private.review_identities r
      join app_private.review_windows w
        on w.closed_at is null
       and w.closes_at > p_as_of
       and w.failed_attempts < w.max_failed_attempts
     where r.user_id = p_user_id
  )
$$;
revoke execute on function app_private.review_identity_in_open_window(uuid, timestamptz)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Rule 1: the trigger. Runs with the owner's rights so that whoever writes
-- the hash (GoTrue's role, the server role, an operator) is judged the
-- same way; it never raises, it only replaces.
-- ---------------------------------------------------------------------------
create function app_private.guard_password_hash()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.encrypted_password is distinct from old.encrypted_password
     and coalesce(new.encrypted_password, '') <> ''
     and not app_private.review_identity_in_open_window(new.id, now()) then
    new.encrypted_password := app_private.scrambled_password_hash();
  end if;
  return new;
end;
$$;
revoke execute on function app_private.guard_password_hash() from public, anon, authenticated;

create trigger guard_password_hash
  before update of encrypted_password on auth.users
  for each row execute function app_private.guard_password_hash();

-- ---------------------------------------------------------------------------
-- Rules 2 and 3: the server-side replacements and revocations.
-- ---------------------------------------------------------------------------
/** Replaces one user's hash with one nobody knows and records the digest
 * of what is now stored (read back after the trigger has had its say, so
 * the record and the row never disagree). Sessions are left alone: an
 * ordinary user signed in by code keeps their session. */
create function app_private.scrub_password(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stored text;
begin
  update auth.users
     set encrypted_password = app_private.scrambled_password_hash(),
         updated_at = now()
   where id = p_user_id
  returning encrypted_password into v_stored;
  if v_stored is null then
    return;
  end if;
  insert into app_private.password_scrubs (user_id, hash_digest, scrubbed_at, scrub_count)
  values (p_user_id, md5(v_stored), now(), 1)
  on conflict (user_id) do update
    set hash_digest = excluded.hash_digest,
        scrubbed_at = excluded.scrubbed_at,
        scrub_count = app_private.password_scrubs.scrub_count + 1;
end;
$$;
revoke execute on function app_private.scrub_password(uuid) from public, anon, authenticated;

/** Ends the review identity's access: the hash replaced and every session
 * revoked (refresh tokens go with the sessions). */
create function app_private.end_review_access(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app_private.scrub_password(p_user_id);
  delete from auth.sessions where user_id = p_user_id;
end;
$$;
revoke execute on function app_private.end_review_access(uuid) from public, anon, authenticated;
grant execute on function app_private.end_review_access(uuid) to service_role;

/** The sweep: expired windows closed with their identity's access ended
 * and a receipt written; then every hash that is not the review
 * identity's inside an open window and is not already the recorded
 * scrambled one is replaced, once. */
create function app_private.review_window_sweep(p_as_of timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window app_private.review_windows%rowtype;
  v_identity app_private.review_identities%rowtype;
  v_user record;
  v_expired integer := 0;
  v_scrubbed integer := 0;
begin
  for v_window in
    select w.* from app_private.review_windows w
     where w.closed_at is null and w.closes_at <= p_as_of
     order by w.opened_at
     for update
  loop
    update app_private.review_windows
       set closed_at = p_as_of, close_reason = 'expired'
     where id = v_window.id;
    select * into v_identity from app_private.review_identities limit 1;
    if found then
      perform app_private.end_review_access(v_identity.user_id);
      perform app_private.append_audit(
        null, v_identity.environment_id, v_identity.client_id, v_identity.entity_id,
        'review.window_closed', 'window:' || v_window.id::text,
        jsonb_build_object('reason', 'expired', 'failed_attempts', v_window.failed_attempts,
                           'closes_at', v_window.closes_at));
    end if;
    v_expired := v_expired + 1;
  end loop;

  for v_user in
    select u.id
      from auth.users u
     where coalesce(u.encrypted_password, '') <> ''
       and not app_private.review_identity_in_open_window(u.id, p_as_of)
       and not exists (
         select 1 from app_private.password_scrubs s
          where s.user_id = u.id and s.hash_digest = md5(u.encrypted_password))
  loop
    perform app_private.scrub_password(v_user.id);
    v_scrubbed := v_scrubbed + 1;
  end loop;

  update app_private.review_sweep_state
     set last_run_at = p_as_of,
         last_expired = v_expired,
         last_scrubbed = v_scrubbed,
         total_expired = total_expired + v_expired,
         total_scrubbed = total_scrubbed + v_scrubbed
   where id;
  return jsonb_build_object('as_of', p_as_of, 'expired', v_expired, 'scrubbed', v_scrubbed);
end;
$$;
revoke execute on function app_private.review_window_sweep(timestamptz) from public, anon, authenticated;

/** The sweep for the tooling and the harness: the server role runs it,
 * optionally as of a later moment, which ends any window whose close
 * time has passed by then. */
create function public.review_sweep(p_as_of timestamptz default now())
returns jsonb
language plpgsql
set search_path = ''
as $$
begin
  perform app_private.require_server_role();
  if p_as_of is null or p_as_of < now() - interval '1 minute' then
    raise exception 'invalid_as_of';
  end if;
  return app_private.review_window_sweep(p_as_of);
end;
$$;
revoke execute on function public.review_sweep(timestamptz) from public, anon, authenticated;
grant execute on function public.review_sweep(timestamptz) to service_role;
grant execute on function app_private.review_window_sweep(timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- Closing and retiring end access on the server.
-- ---------------------------------------------------------------------------
create or replace function public.close_review_window(p_idempotency_key uuid)
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
    perform app_private.end_review_access(v_identity.user_id);
    perform app_private.append_audit(
      null, v_identity.environment_id, v_identity.client_id, v_identity.entity_id,
      'review.window_closed', 'window:' || v_open.id::text,
      jsonb_build_object('reason', 'closed', 'failed_attempts', v_open.failed_attempts,
                         'idempotency_key', p_idempotency_key));
  end if;
  return jsonb_build_object('window_id', v_open.id, 'closed_at', v_now, 'replayed', false);
end;
$$;

create or replace function public.unregister_review_identity(p_user_id uuid)
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
  perform app_private.end_review_access(p_user_id);
  perform app_private.append_audit(
    null, v_identity.environment_id, v_identity.client_id, v_identity.entity_id,
    'review.identity_unregistered', 'user:' || p_user_id::text, '{}'::jsonb);
  return jsonb_build_object('user_id', p_user_id, 'registered', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- The status carries the sweep.
-- ---------------------------------------------------------------------------
create or replace function public.review_window_status()
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_window app_private.review_windows;
  v_sweep app_private.review_sweep_state;
  v_base jsonb;
begin
  perform app_private.require_server_role();
  select * into v_sweep from app_private.review_sweep_state where id;
  v_base := jsonb_build_object(
    'review_identities', (select count(*) from app_private.review_identities),
    'sweep', jsonb_build_object(
      'last_run_at', v_sweep.last_run_at,
      'last_expired', v_sweep.last_expired,
      'last_scrubbed', v_sweep.last_scrubbed,
      'total_expired', v_sweep.total_expired,
      'total_scrubbed', v_sweep.total_scrubbed),
    'scrubbed_users', (select count(*) from app_private.password_scrubs));
  v_window := app_private.current_review_window();
  if v_window.id is null then
    return v_base || jsonb_build_object('open', false);
  end if;
  return v_base || jsonb_build_object('open', true, 'window_id', v_window.id,
    'opened_at', v_window.opened_at, 'closes_at', v_window.closes_at,
    'failed_attempts', v_window.failed_attempts,
    'max_failed_attempts', v_window.max_failed_attempts);
end;
$$;

-- ---------------------------------------------------------------------------
-- The schedule, where the extension exists (the CLI stack and the hosted
-- projects); the plain-PostgreSQL lane runs the sweep by hand.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    execute 'create extension if not exists pg_cron';
    execute $q$select cron.unschedule(j.jobid) from cron.job j where j.jobname = 'hive-review-window-sweep'$q$;
    execute $q$select cron.schedule('hive-review-window-sweep', '* * * * *', 'select app_private.review_window_sweep()')$q$;
  else
    raise notice 'pg_cron is not available here: run the review window sweep by hand (review-window sweep)';
  end if;
end;
$$;
