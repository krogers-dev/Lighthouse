-- HIVE Milestone 0: row-level security and least-privilege grants.
--
-- Model: anonymous users see nothing anywhere. Authenticated users hold
-- SELECT only, and only on rows their server-controlled membership covers.
-- No client role can insert, update, or delete anything in Milestone 0
-- (the dashboard is read-only); memberships and audit receipts accept no
-- client access at all beyond a user reading their own membership rows.
-- Enforcement is RLS + grants, never UI, and policies use membership
-- lookups, not `authenticated` alone and never user_metadata.

-- ---------------------------------------------------------------------------
-- Revoke the platform's permissive defaults, then grant narrowly.
-- ---------------------------------------------------------------------------

revoke all on all tables in schema public from public;
revoke all on all tables in schema public from anon;
revoke all on all tables in schema public from authenticated;

-- Future tables in public must not inherit permissive defaults either.
alter default privileges in schema public revoke all on tables from public;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on tables from authenticated;

-- The unexposed schema is reachable only by privileged server roles.
revoke all on schema app_private from public;
grant usage on schema app_private to service_role;

revoke execute on all functions in schema app_private from public;
revoke execute on all functions in schema app_private from anon;
revoke execute on all functions in schema app_private from authenticated;
grant execute on function app_private.append_audit(uuid, uuid, uuid, uuid, text, text, jsonb)
  to service_role;

-- Narrow read grants: RLS below decides *which rows*.
grant select on public.environments to authenticated;
grant select on public.clients to authenticated;
grant select on public.entities to authenticated;
grant select on public.memberships to authenticated;
grant select on public.cases to authenticated;
grant select on public.case_attention_items to authenticated;
grant select on public.case_next_actions to authenticated;
-- audit_receipts: no grant to anon or authenticated at all in Milestone 0.

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table public.environments enable row level security;
alter table public.clients enable row level security;
alter table public.entities enable row level security;
alter table public.memberships enable row level security;
alter table public.cases enable row level security;
alter table public.case_attention_items enable row level security;
alter table public.case_next_actions enable row level security;
alter table public.audit_receipts enable row level security;

-- A user sees exactly their own membership rows.
create policy memberships_select_own
  on public.memberships
  for select
  to authenticated
  using (user_id = (select auth.uid()));

-- Scope tables: visible only through a covering membership.
create policy environments_select_by_membership
  on public.environments
  for select
  to authenticated
  using (exists (
    select 1 from public.memberships m
    where m.user_id = (select auth.uid())
      and m.environment_id = environments.id
  ));

create policy clients_select_by_membership
  on public.clients
  for select
  to authenticated
  using (exists (
    select 1 from public.memberships m
    where m.user_id = (select auth.uid())
      and m.environment_id = clients.environment_id
      and m.client_id = clients.id
  ));

create policy entities_select_by_membership
  on public.entities
  for select
  to authenticated
  using (exists (
    select 1 from public.memberships m
    where m.user_id = (select auth.uid())
      and m.environment_id = entities.environment_id
      and m.client_id = entities.client_id
      and m.entity_id = entities.id
  ));

-- Workflow tables: exact (environment, client, entity) membership.
create policy cases_select_by_membership
  on public.cases
  for select
  to authenticated
  using (exists (
    select 1 from public.memberships m
    where m.user_id = (select auth.uid())
      and m.environment_id = cases.environment_id
      and m.client_id = cases.client_id
      and m.entity_id = cases.entity_id
  ));

create policy case_attention_items_select_by_membership
  on public.case_attention_items
  for select
  to authenticated
  using (exists (
    select 1 from public.memberships m
    where m.user_id = (select auth.uid())
      and m.environment_id = case_attention_items.environment_id
      and m.client_id = case_attention_items.client_id
      and m.entity_id = case_attention_items.entity_id
  ));

create policy case_next_actions_select_by_membership
  on public.case_next_actions
  for select
  to authenticated
  using (exists (
    select 1 from public.memberships m
    where m.user_id = (select auth.uid())
      and m.environment_id = case_next_actions.environment_id
      and m.client_id = case_next_actions.client_id
      and m.entity_id = case_next_actions.entity_id
  ));

-- audit_receipts: RLS enabled, zero policies, zero grants — deny by both
-- layers for every client role.
