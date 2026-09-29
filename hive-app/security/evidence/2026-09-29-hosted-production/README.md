# The hosted production project — 2026-09-29

Created from Kody's desktop under his general grant and his "Help here"
for the production project (2026-09-29), on the organization's Free plan
until he upgrades it: nothing spent, no term accepted. The database
password lives only in his approvals folder; the service key was never
written anywhere.

| Step | Command                                                                 | Result                                                                                                                                    |
| ---- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `supabase projects create hive-production` (us-east-2, Honeybee Accounting) | ✅ ref `nceencyvxfhkffbjqlea`, ACTIVE_HEALTHY                                                                                              |
| 2    | `supabase db push --db-url <pooler URL as postgres>`                    | ✅ thirteen migrations applied in order — `db-push.log`                                                                                    |
| 3    | `HIVE_DB_URL=<pooler URL> node scripts/db-types.mjs check`              | ✅ committed types match the production schema — `db-types-check.log`                                                                     |
| 4    | state read as `postgres`                                                | ✅ no users, no environments, no memberships, every protected table under RLS — `state.log`; **no seed of any kind, by rule**              |
| 5    | `supabase projects api-keys` (publishable only); the manifest           | ✅ the release profile now names the production origin and its publishable key; staging stays the rehearsal environment                    |
| 6    | the dashboard auth settings, the SMTP key, the template                 | ⏳ Kody's own clicks on the production dashboard, the same list as staging; the CLI cannot push them on this organization (the hook rule) |

## What this proves

- The production schema is the migrations, nothing else: same
  thirteen files, same types, empty of data.
- The release configuration points at the real target, and
  `config:check --profile release` fails on exactly one remaining value,
  the public deletion page's address.

## What this does not prove

- Sign-in on production: its auth settings and SMTP are not yet set
  (step 6), and pgTAP is not run there because the suites need the
  synthetic seed that production never carries; staging holds that proof.
