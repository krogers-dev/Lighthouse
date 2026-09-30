-- Review tenant fallback (WO-009): without GoTrue's password-verification
-- hook, the server still admits only the review identity, only inside an
-- open window: a trigger replaces every other password hash as it is
-- written, a sweep expires windows and revokes the identity's sessions,
-- and closing or retiring ends access on the server. The hook's own
-- suite (013) still holds; this one proves the rules that do not need it.
--
-- Seeded state this suite relies on: client.owner holds client_user on
-- A1; client.second exists with a membership of its own. The suite
-- registers client.owner as the review identity for its own duration
-- (rolled back).
begin;
-- Explicit: pgTAP lives in the extensions schema on a hosted project.
set local search_path = public, extensions;
select plan(24);

-- A hosted rehearsal project may already hold the review tenant (WO-011):
-- its identity registered, its receipts written, even a window open. This
-- suite registers its own identity and opens its own windows, so it starts
-- from none, inside the transaction that is rolled back at the end, and it
-- counts receipts in its own scope only.
delete from app_private.review_identities;
update app_private.review_windows
   set closed_at = now(), close_reason = 'closed'
 where closed_at is null;

create function pg_temp.user_id_for(p_email text)
returns uuid language sql stable security definer as $$
  select id from auth.users where lower(email) = lower(p_email)
$$;
create function pg_temp.become_service_role()
returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'service_role', true);
end;
$$;
create function pg_temp.become_superuser()
returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end;
$$;
/** Writes a known password for a user the way any writer would (a plain
 * update of the hash) and says whether that password still verifies
 * against what is stored afterwards. */
create function pg_temp.set_known_password(p_email text, p_password text)
returns boolean language plpgsql security definer as $$
declare
  v_stored text;
begin
  update auth.users
     set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf'))
   where lower(email) = lower(p_email)
  returning encrypted_password into v_stored;
  return v_stored = extensions.crypt(p_password, v_stored);
end;
$$;
create function pg_temp.password_verifies(p_email text, p_password text)
returns boolean language sql stable security definer as $$
  select u.encrypted_password = extensions.crypt(p_password, u.encrypted_password)
    from auth.users u where lower(u.email) = lower(p_email)
$$;
create function pg_temp.open_session(p_email text)
returns uuid language plpgsql security definer as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into auth.sessions (id, user_id, created_at, updated_at, aal)
  values (v_id, pg_temp.user_id_for(p_email), now(), now(), 'aal1');
  return v_id;
end;
$$;
create function pg_temp.session_count(p_email text)
returns integer language sql stable security definer as $$
  select count(*)::int from auth.sessions s where s.user_id = pg_temp.user_id_for(p_email)
$$;
create function pg_temp.audit_count(p_action text, p_reason text)
returns integer language sql security definer as $$
  select count(*)::int from public.audit_receipts
   where action = p_action and environment_id = '11111111-0000-4000-8000-000000000001'
     and (p_reason is null or details ->> 'reason' = p_reason)
$$;
create function pg_temp.cron_job_present()
returns boolean language plpgsql as $$
declare
  v_present boolean;
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    return true; -- no scheduler here: the sweep runs by hand, by design
  end if;
  execute $q$select exists (select 1 from cron.job where jobname = 'hive-review-window-sweep')$q$
    into v_present;
  return v_present;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants and shape
-- ---------------------------------------------------------------------------
select is(has_function_privilege('authenticated', 'public.review_sweep(timestamptz)', 'execute'), false,
  'authenticated cannot run the sweep');                                                     -- 1
select is(has_function_privilege('anon', 'app_private.end_review_access(uuid)', 'execute'), false,
  'anon cannot end review access');                                                          -- 2
select is(has_function_privilege('service_role', 'public.review_sweep(timestamptz)', 'execute'), true,
  'the server role can run the sweep');                                                      -- 3
select is((select count(*)::int from pg_trigger
   where tgrelid = 'auth.users'::regclass and tgname = 'guard_password_hash' and not tgisinternal), 1,
  'the hash guard is on auth.users');                                                        -- 4
select ok(pg_temp.cron_job_present(), 'the sweep is scheduled where a scheduler exists');   -- 5

-- ---------------------------------------------------------------------------
-- Rule 1: nobody but the review identity inside a window holds a password
-- ---------------------------------------------------------------------------
select pg_temp.become_superuser();
select is(pg_temp.set_known_password('client.second@example.invalid', 'known-second-password'), false,
  'a password written for an ordinary user is replaced as it is written');                  -- 6
select is(pg_temp.set_known_password('client.owner@example.invalid', 'known-owner-password'), false,
  'so is one for the future review identity while no window is open');                     -- 7

select pg_temp.become_service_role();
select public.register_review_identity(pg_temp.user_id_for('client.owner@example.invalid'),
  '11111111-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001',
  'aaaaaaaa-1111-4000-8000-000000000001');
select gen_random_uuid() as open_key \gset
select public.open_review_window(1, :'open_key');
select pg_temp.become_superuser();
select is(pg_temp.set_known_password('client.owner@example.invalid', 'the-review-code-123456'), true,
  'inside an open window the review identity keeps the code it is given');                 -- 8
select is(pg_temp.set_known_password('client.second@example.invalid', 'known-second-password'), false,
  'while anyone else is still replaced');                                                    -- 9

-- ---------------------------------------------------------------------------
-- Rule 3: closing ends access on the server
-- ---------------------------------------------------------------------------
select pg_temp.open_session('client.owner@example.invalid');
select is(pg_temp.session_count('client.owner@example.invalid'), 1, 'the identity holds a session'); -- 10
select pg_temp.become_service_role();
select gen_random_uuid() as close_key \gset
select is(public.close_review_window(:'close_key') ->> 'replayed', 'false', 'the server role closes the window'); -- 11
select is(pg_temp.password_verifies('client.owner@example.invalid', 'the-review-code-123456'), false,
  'closing replaces the code with a hash nobody knows');                                     -- 12
select is(pg_temp.session_count('client.owner@example.invalid'), 0,
  'and revokes every session of the identity');                                              -- 13
select is(pg_temp.audit_count('review.window_closed', 'closed'), 1,
  'with a receipt that says why');                                                           -- 14

-- ---------------------------------------------------------------------------
-- Rule 2: the sweep expires a window that nobody closed
-- ---------------------------------------------------------------------------
select public.open_review_window(1, gen_random_uuid());
select pg_temp.become_superuser();
select ok(pg_temp.set_known_password('client.owner@example.invalid', 'the-review-code-654321'),
  'a second window, the code set again');                                                   -- 15
select pg_temp.open_session('client.owner@example.invalid');
select pg_temp.become_service_role();
select is((public.review_sweep(now()) ->> 'expired')::int, 0,
  'the sweep as of now leaves an unexpired window alone');                                   -- 16
select is(pg_temp.password_verifies('client.owner@example.invalid', 'the-review-code-654321'), true,
  'and the code still stands');                                                              -- 17
select throws_ok($$select public.review_sweep(now() - interval '1 day')$$, 'P0001', 'invalid_as_of',
  'the sweep cannot be run as of the past');                                                 -- 18
select is((public.review_sweep(now() + interval '2 hours') ->> 'expired')::int, 1,
  'as of two hours on, the one-hour window has expired and the sweep closes it');          -- 19
select is((public.review_window_status() ->> 'open')::boolean, false, 'the status reads closed'); -- 20
select is(pg_temp.password_verifies('client.owner@example.invalid', 'the-review-code-654321'), false,
  'the expired window took the code with it');                                               -- 21
select is(pg_temp.session_count('client.owner@example.invalid'), 0, 'and the sessions');      -- 22
select is(pg_temp.audit_count('review.window_closed', 'expired'), 1,
  'with a receipt that says it expired');                                                    -- 23

-- ---------------------------------------------------------------------------
-- The scrub converges: a second sweep changes nothing
-- ---------------------------------------------------------------------------
select is((public.review_sweep(now() + interval '2 hours') ->> 'scrubbed')::int, 0,
  'once every stray hash is recorded, a sweep scrubs nothing');                             -- 24

select * from finish();
rollback;
