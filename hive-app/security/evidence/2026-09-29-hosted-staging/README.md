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
| 8    | the dashboard auth settings from Kody's own session                                              | ✅ by Kody's own clicks (the session's permission policy refused the change itself), read back: sign-ups off, code length 6, minimum password length 12 — `dashboard-user-signups.jpg`, `dashboard-email-provider.jpg`; the rate limit (locked at 2 per hour by the built-in mailer, `dashboard-rate-limits.jpg`) and the templates unlocked with step 10 |
| 9    | Resend: the domain `myhbcfo.com` added from this session; its three DNS records entered by Kody at Squarespace | ✅ verified by Resend (`resend-domain-verified.jpg`); the records served by the authoritative name server, Google's mail records untouched   |
| 10   | the dashboard SMTP settings entered by Kody                                                        | ✅ read back with the password hidden — `dashboard-smtp-settings.jpg`; the Magic Link template pasted by Kody — `dashboard-template-preview.jpg`; the rate limit reads 30 per hour |
| 11   | the four-step hosted OTP acceptance, black-box through the public sign-in path                   | ✅ PASS — `hosted-otp-acceptance.md`, `resend-email-delivered.jpg`                                                                             |
| 12   | the QA identity granted `client_user` on the synthetic entity; Metro restarted with the staging origin; the served bundle checked | ✅ one membership; staging origin once, no loopback, the publishable key once, no secret-shaped value in 9.2 MB of bundle |
| 13   | three scratch Maestro flows on Pixel_8: request the code, enter it, browse the requests            | ✅ PASS — `device-01-code-screen.png`, `device-02-dashboard.png`, `device-03-requests.png`, `device-04-request-detail.png`; one `aal1` session on staging; first attempt refused on the device with no request at the gateway and an emulator runtime abort seconds later, second attempt clean |

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

- The staff surface against staging: the QA identity is a client user;
  staff enrollment and AAL2 against the hosted project are not yet run.
- The review tenant is not on staging; its hook is a Teams/Enterprise
  feature (open finding in the WO-008 plan).
