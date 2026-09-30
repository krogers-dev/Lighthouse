-- Review tenant (WO-008, option A): the password-verification hook admits
-- exactly one identity, only while a review window is open, and audits
-- every attempt; the server role registers the identity and opens and
-- closes windows with replay and refusals; failures close a window.
--
-- Seeded state this suite relies on: client.owner holds client_user on
-- A1; nomember.norman exists with no memberships. The suite registers
-- client.owner as the review identity for its own duration (rolled back).
begin;
-- Explicit: pgTAP lives in the extensions schema on a hosted project.
set local search_path = public, extensions;
select plan(30);

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

create function pg_temp.become_superuser()
returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end;
$$;

create function pg_temp.become_service_role()
returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'service_role', true);
end;
$$;

-- The hook runs as GoTrue's role in production; its grants are asserted
-- above, and here it runs as the connection role (the CLI stack's postgres
-- is not a member of supabase_auth_admin).
create function pg_temp.become_auth_admin()
returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end;
$$;

create function pg_temp.hook(p_email text, p_valid boolean)
returns jsonb language sql as $$
  select app_private.review_password_verification(
    jsonb_build_object('user_id', pg_temp.user_id_for(p_email), 'valid', p_valid))
$$;
create function pg_temp.audit_count(p_action text)
returns integer language sql security definer as $$
  select count(*)::int from public.audit_receipts
   where action = p_action and environment_id = '11111111-0000-4000-8000-000000000001'
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
select is(has_function_privilege('supabase_auth_admin',
  'app_private.review_password_verification(jsonb)', 'execute'), true,
  'GoTrue''s role can run the hook');                                        -- 1
select is(has_function_privilege('authenticated',
  'app_private.review_password_verification(jsonb)', 'execute'), false,
  'authenticated cannot');                                                   -- 2
select is(has_function_privilege('anon',
  'app_private.review_password_verification(jsonb)', 'execute'), false,
  'anon cannot');                                                            -- 3
select is((select count(*)::int from information_schema.role_table_grants
   where table_schema = 'app_private' and table_name in ('review_identities', 'review_windows')
     and grantee in ('anon', 'authenticated')), 0,
  'client roles hold nothing on the review tables');                         -- 4
select is(has_function_privilege('authenticated', 'public.open_review_window(integer,uuid)', 'execute'), false,
  'authenticated cannot open a window');                                     -- 5
select is(has_function_privilege('service_role', 'public.open_review_window(integer,uuid)', 'execute'), true,
  'the server role can');                                                    -- 6
select is(has_function_privilege('authenticated', 'public.register_review_identity(uuid,uuid,uuid,uuid)', 'execute'), false,
  'authenticated cannot register a review identity');                        -- 7

-- ---------------------------------------------------------------------------
-- Registration
-- ---------------------------------------------------------------------------
select pg_temp.become_service_role();
select throws_ok(
  $$select public.register_review_identity(pg_temp.user_id_for('nomember.norman@example.invalid'),
    '11111111-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001',
    'aaaaaaaa-1111-4000-8000-000000000001')$$,
  'P0001', 'not_a_client_user_of_scope',
  'only a client user of the scope can be the review identity');            -- 8
select is((public.register_review_identity(pg_temp.user_id_for('client.owner@example.invalid'),
    '11111111-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001',
    'aaaaaaaa-1111-4000-8000-000000000001') ->> 'registered')::boolean, true,
  'the server role registers the review identity');                          -- 9
select is(pg_temp.audit_count('review.identity_registered'), 1,
  'with one audit receipt in its scope');                                    -- 10

-- ---------------------------------------------------------------------------
-- The hook without a window
-- ---------------------------------------------------------------------------
select pg_temp.become_auth_admin();
select is(pg_temp.hook('client.second@example.invalid', true) ->> 'decision', 'reject',
  'a valid password for anyone but the review identity is rejected');       -- 11
select is(pg_temp.hook('client.owner@example.invalid', true) ->> 'decision', 'reject',
  'the review identity is rejected while no window is open');               -- 12
select is(pg_temp.audit_count('review.sign_in_refused'), 1,
  'and the refusal is audited');                                             -- 13
select is(pg_temp.hook('nomember.norman@example.invalid', true) ->> 'decision', 'reject',
  'a stranger is rejected without an audit receipt (no scope to write it in)'); -- 14
select is((app_private.review_password_verification('{"valid": true}'::jsonb)) ->> 'decision', 'reject',
  'an event without a user id is rejected');                                 -- 15

-- ---------------------------------------------------------------------------
-- A window
-- ---------------------------------------------------------------------------
select pg_temp.become_service_role();
select throws_ok($$select public.open_review_window(0, gen_random_uuid())$$, 'P0001', 'invalid_hours',
  'a window is at least an hour');                                           -- 16
select throws_ok($$select public.open_review_window(169, gen_random_uuid())$$, 'P0001', 'invalid_hours',
  'and at most a week');                                                     -- 17
select gen_random_uuid() as open_key \gset
select public.open_review_window(24, :'open_key') as opened \gset
select ok((:'opened'::jsonb ->> 'window_id') is not null, 'the server role opens a window');  -- 18
select is((public.open_review_window(24, :'open_key') ->> 'replayed')::boolean, true,
  'the same key replays the same window');                                   -- 19
select throws_ok($$select public.open_review_window(24, gen_random_uuid())$$, 'P0001', 'window_already_open',
  'one open window at a time');                                              -- 20
select is((public.review_window_status() ->> 'open')::boolean, true,
  'the status reads open');                                                  -- 21

select pg_temp.become_auth_admin();
select is(pg_temp.hook('client.owner@example.invalid', true) ->> 'decision', 'continue',
  'inside the window, the review identity with a valid password continues'); -- 22
select is(pg_temp.audit_count('review.signed_in'), 1,
  'and the sign-in is audited');                                             -- 23
select is(pg_temp.hook('client.second@example.invalid', true) ->> 'decision', 'reject',
  'inside the window, anyone else is still rejected');                       -- 24
select is(pg_temp.hook('client.owner@example.invalid', false) ->> 'decision', 'reject',
  'a wrong password is rejected');                                           -- 25
select pg_temp.become_service_role();
select is((public.review_window_status() ->> 'failed_attempts')::int, 1,
  'and counted');                                                            -- 26

-- Exhaust the window: nine more failures close it.
select pg_temp.become_auth_admin();
select pg_temp.hook('client.owner@example.invalid', false) from generate_series(1, 9);
select is(pg_temp.hook('client.owner@example.invalid', true) ->> 'decision', 'reject',
  'after too many failures the window is closed and even a valid password is rejected'); -- 27
select pg_temp.become_service_role();
select is((public.review_window_status() ->> 'open')::boolean, false,
  'the status reads closed');                                                -- 28
select throws_ok($$select public.close_review_window(gen_random_uuid())$$, 'P0001', 'no_open_window',
  'closing an exhausted window is a refusal, not a change');                 -- 29

-- A fresh window closes on request, with replay.
select gen_random_uuid() as close_key \gset
select public.open_review_window(1, gen_random_uuid());
select is(public.close_review_window(:'close_key') ->> 'replayed', 'false', 'the server role closes the window'); -- 30

select * from finish();
rollback;
