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
| 6    | the dashboard auth settings, the SMTP key, the template                 | ✅ by Kody's own clicks ("production set"), read back — `dashboard-user-signups.jpg`, `dashboard-email-provider.jpg`, `dashboard-smtp-settings.jpg`, `dashboard-rate-limits.jpg` |
| 7    | the four-step hosted OTP acceptance, black-box through the public sign-in path | ✅ PASS, the test identity deleted afterwards, 0 users — `hosted-otp-acceptance.md`                                              |
| 8    | the two public pages and the release check                              | ✅ `config:check --profile release` OK on the four release values — `config-check-release.log`, `site-pages.log`                    |

## What this proves

- The production schema is the migrations, nothing else: same
  thirteen files, same types, empty of data.
- The release configuration points at the real target, and
  `config:check --profile release` passes on the four release values
  (the origin and key, the support address, the live deletion page).
- Sign-in on production works end to end: the acceptance passed and left
  no account behind.

## What this does not prove

- pgTAP on production: the suites need the synthetic seed that production
  never carries; staging holds that proof on the same migrations.
- The app on a device against production: nothing to sign in as until
  Kody invites the first staff identity.
