# The hosted staging project — 2026-09-29

Executed on Kody's Windows desktop from a local Claude session, under
Kody's general grant of 2026-09-29 and his "Supabase door open" (the CLI
signed in by him) followed by "do what you recommend." Nothing here
spends, accepts a term, submits, or releases; the project is on the
organization's Free plan. The database password and the service key are
not in this folder or anywhere in the repository.

| Step | Command                                                                                          | Result                                                                                                                                        |
| ---- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `supabase projects create hive-staging` (us-east-2, Honeybee Accounting), `supabase link`        | ✅ ref `zhdvmllscjyepwucbtzq`; the generated password stored in Kody's approvals folder only                                                  |
| 2    | `supabase db push`, then `supabase migration list --linked`                                      | ✅ thirteen migrations local = remote — `migration-list.log`                                                                                   |
| 3    | `create extension pgtap with schema extensions`; the SQL-only lane's three seed files, in order  | ✅ 9 placeholder identities (empty password hashes, `example.invalid`), 1 environment, 2 clients, 15 memberships, 5 synthetic documents         |
| 4    | `supabase test db --db-url <pooler URL as postgres>`                                             | ✅ 13 files, **487 tests, PASS**, 69 s — `pgtap-hosted.log` (the password is not in the log)                                                    |
| 5    | `HIVE_DB_URL=<pooler URL> node scripts/db-types.mjs check`                                       | ✅ committed types match the hosted schema — `db-types-check.log`                                                                              |
| 6    | `supabase config push` with `[remotes.staging]` (override loaded), twice, then with hooks masked | ❌ by the platform: HTTP 402, the password-verification hook cannot be configured on this organization, even off — `config-push.log`            |
| 7    | `supabase projects api-keys`; `security/approved-config.json` release profile                    | ✅ origin and publishable key approved; `config:check --profile release` fails on exactly the two public contacts                               |
| 8    | the dashboard auth settings from Kody's own session                                              | ⏳ Kody signed in; the session's permission policy refused the change itself (modifying a shared resource), so the clicks are his, from the values recorded in `supabase/config.toml` under `[remotes.staging]`        |

## What this proves

- Every migration, policy, grant, transition, and the review-tenant
  functions behave on the hosted Postgres 17 exactly as on the local
  stack: the same 487 assertions pass as the `postgres` role through the
  pooler.
- The committed client types are the hosted schema's types.
- The one hosted difference found (pgTAP in `extensions`, the CLI's login
  role without `BYPASSRLS`) is fixed in the suites themselves, not by a
  hosted-only step.

## What this does not prove

- No hosted sign-in has happened: sign-ups are still at the project
  default until the dashboard step, and no email can reach a recipient
  until Kody's SMTP provider exists.
- The review tenant is not on staging; its hook is a Teams/Enterprise
  feature (open finding in the WO-008 plan).
