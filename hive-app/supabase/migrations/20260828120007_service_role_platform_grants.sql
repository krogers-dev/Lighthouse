-- service_role platform-baseline grants, made explicit.
--
-- The privileged server role's table access had been inherited from the
-- environment: scripts/sql/supabase-shim.sql sets default privileges
-- granting service_role ALL before migrations run on the self-hosted
-- lanes, and the hosted platform provisions the same. The Supabase CLI
-- stack does neither for tables these migrations create — proven on the
-- first desktop seed (2026-08-28), where PostgREST answered 403 to a
-- STACK-ISSUED legacy service_role JWT on a plain select. A baseline a
-- lane can silently lack is not a baseline; it is now carried here,
-- idempotently, so every composition agrees.
--
-- Scope note: service_role is the server-side trusted role. It is never
-- shipped to the mobile app (SECURITY invariant: the app holds only the
-- URL and the public client key), carries BYPASSRLS on every lane, and
-- on the hosted platform already holds these grants. This migration
-- changes nothing for anon or authenticated, whose least-privilege
-- grants and RLS remain exactly as migrations 2-6 left them.

grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant all on all functions in schema public to service_role;

alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public grant all on functions to service_role;
