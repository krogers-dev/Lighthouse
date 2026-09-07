-- Staff reads require AAL2 at the database (independent review P1-1).
--
-- Previously AAL2-for-staff was enforced only by the client controller,
-- which the untrusted app cannot be trusted to do: an aal1 JWT obtained
-- with email OTP alone could read every row a staff membership covers by
-- calling PostgREST directly. Policies now grant through a membership only
-- when the membership is client_user OR the JWT carries aal2; a missing
-- aal claim counts as aal1 (fail closed). A user's own membership rows
-- stay visible at aal1 — the client needs them to know MFA is required —
-- and they expose no client content.

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
  using (exists (
    select 1 from public.memberships m
    where m.user_id = (select auth.uid())
      and m.environment_id = environments.id
      and (m.role = 'client_user'
           or (select coalesce(auth.jwt() ->> 'aal', 'aal1')) = 'aal2')
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
      and (m.role = 'client_user'
           or (select coalesce(auth.jwt() ->> 'aal', 'aal1')) = 'aal2')
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
      and (m.role = 'client_user'
           or (select coalesce(auth.jwt() ->> 'aal', 'aal1')) = 'aal2')
  ));

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
      and (m.role = 'client_user'
           or (select coalesce(auth.jwt() ->> 'aal', 'aal1')) = 'aal2')
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
      and (m.role = 'client_user'
           or (select coalesce(auth.jwt() ->> 'aal', 'aal1')) = 'aal2')
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
      and (m.role = 'client_user'
           or (select coalesce(auth.jwt() ->> 'aal', 'aal1')) = 'aal2')
  ));
