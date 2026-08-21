-- Global staff AAL2 gate (PM directive P1 item 4).
--
-- The previous per-membership rule let a mixed-role account (client_user
-- plus staff) reach protected rows at AAL1 through its client_user
-- membership, bypassing the intended rule that any staff user completes
-- MFA before reading anything. Database enforcement now matches the
-- controller exactly: if the current user holds ANY staff membership,
-- every protected read requires an aal2 JWT claim (a missing claim counts
-- as aal1, fail closed). Exact scope checks apply after that gate, through
-- any covering membership. A user's own membership rows remain visible at
-- AAL1 — ids and roles only, no client or workflow content — because the
-- client needs them to route to MFA; that exception is stated in
-- SECURITY.md and asserted by the pgTAP suites.

drop policy environments_select_by_membership on public.environments;
drop policy clients_select_by_membership on public.clients;
drop policy entities_select_by_membership on public.entities;
drop policy cases_select_by_membership on public.cases;
drop policy case_attention_items_select_by_membership on public.case_attention_items;
drop policy case_next_actions_select_by_membership on public.case_next_actions;

create policy environments_select_by_membership
  on public.environments
  for select
  to authenticated
  using (
    (
      (select coalesce(auth.jwt() ->> 'aal', 'aal1')) = 'aal2'
      or not exists (
        select 1 from public.memberships s
        where s.user_id = (select auth.uid()) and s.role <> 'client_user'
      )
    )
    and exists (
      select 1 from public.memberships m
      where m.user_id = (select auth.uid())
        and m.environment_id = environments.id
    )
  );

create policy clients_select_by_membership
  on public.clients
  for select
  to authenticated
  using (
    (
      (select coalesce(auth.jwt() ->> 'aal', 'aal1')) = 'aal2'
      or not exists (
        select 1 from public.memberships s
        where s.user_id = (select auth.uid()) and s.role <> 'client_user'
      )
    )
    and exists (
      select 1 from public.memberships m
      where m.user_id = (select auth.uid())
        and m.environment_id = clients.environment_id
        and m.client_id = clients.id
    )
  );

create policy entities_select_by_membership
  on public.entities
  for select
  to authenticated
  using (
    (
      (select coalesce(auth.jwt() ->> 'aal', 'aal1')) = 'aal2'
      or not exists (
        select 1 from public.memberships s
        where s.user_id = (select auth.uid()) and s.role <> 'client_user'
      )
    )
    and exists (
      select 1 from public.memberships m
      where m.user_id = (select auth.uid())
        and m.environment_id = entities.environment_id
        and m.client_id = entities.client_id
        and m.entity_id = entities.id
    )
  );

create policy cases_select_by_membership
  on public.cases
  for select
  to authenticated
  using (
    (
      (select coalesce(auth.jwt() ->> 'aal', 'aal1')) = 'aal2'
      or not exists (
        select 1 from public.memberships s
        where s.user_id = (select auth.uid()) and s.role <> 'client_user'
      )
    )
    and exists (
      select 1 from public.memberships m
      where m.user_id = (select auth.uid())
        and m.environment_id = cases.environment_id
        and m.client_id = cases.client_id
        and m.entity_id = cases.entity_id
    )
  );

create policy case_attention_items_select_by_membership
  on public.case_attention_items
  for select
  to authenticated
  using (
    (
      (select coalesce(auth.jwt() ->> 'aal', 'aal1')) = 'aal2'
      or not exists (
        select 1 from public.memberships s
        where s.user_id = (select auth.uid()) and s.role <> 'client_user'
      )
    )
    and exists (
      select 1 from public.memberships m
      where m.user_id = (select auth.uid())
        and m.environment_id = case_attention_items.environment_id
        and m.client_id = case_attention_items.client_id
        and m.entity_id = case_attention_items.entity_id
    )
  );

create policy case_next_actions_select_by_membership
  on public.case_next_actions
  for select
  to authenticated
  using (
    (
      (select coalesce(auth.jwt() ->> 'aal', 'aal1')) = 'aal2'
      or not exists (
        select 1 from public.memberships s
        where s.user_id = (select auth.uid()) and s.role <> 'client_user'
      )
    )
    and exists (
      select 1 from public.memberships m
      where m.user_id = (select auth.uid())
        and m.environment_id = case_next_actions.environment_id
        and m.client_id = case_next_actions.client_id
        and m.entity_id = case_next_actions.entity_id
    )
  );
