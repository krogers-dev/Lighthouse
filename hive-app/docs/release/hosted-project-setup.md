# Hosted project setup (staging executed 2026-09-29 under Kody's general grant)

**Status: the STAGING project exists, is linked, carries every migration,
passes every pgTAP suite, and holds the approved origin and key. Two
things on it are still open: its auth settings (section 2: the CLI cannot
apply them on this organization's plan, so they are applied in the
dashboard from Kody's own session) and email delivery (section 3: Kody's
provider). The production project is not created; creating it, choosing
its plan, and paying for it are Kody's own actions, and this page is the
exact procedure for it, corrected by what staging taught.**

## 0. What exists

| Item              | Value                                                                                                                                                                                                                              |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Project           | `hive-staging`, ref `zhdvmllscjyepwucbtzq`, region us-east-2, organization "Honeybee Accounting" (`khmcgfptzqytqkehadni`), **Free plan**                                                                                           |
| Created           | 2026-09-29 by the CLI under Kody's CLI login, after his "Supabase door open" and "do what you recommend."; recorded in `security/APPROVALS.md`                                                                                     |
| Database password | generated here; lives only in `%USERPROFILE%\HIVE-approvals\hive-staging-db-password.txt` (owner-only), for Kody to move into his password manager; never printed, never in the repository                                         |
| Origin and key    | `https://zhdvmllscjyepwucbtzq.supabase.co` and its publishable key: the release profile of `security/approved-config.json`; the service key was read once by the CLI and written nowhere                                           |
| Connection        | session pooler `aws-0-us-east-2.pooler.supabase.com:5432`, user `postgres.zhdvmllscjyepwucbtzq` (the `aws-1` host does not know this tenant); the CLI stack's database container supplies the psql client on a desktop without one |

## 1. Schema and policies (done)

```bash
npx supabase link --project-ref zhdvmllscjyepwucbtzq
```

```bash
npx supabase db push
```

All thirteen migrations applied in order (`security/evidence/2026-09-29-hosted-staging/migration-list.log`).
Then, once, as `postgres`:

```sql
create extension if not exists pgtap with schema extensions;
```

and the synthetic seed of the SQL-only lane, in its order (`supabase/seed.sql`,
`supabase/seeds/pgtap-identities.sql`, `supabase/seeds/synthetic-documents.sql`),
through the CLI stack's psql client (`docker exec -i supabase_db_hive-app psql <pooler URL> -v ON_ERROR_STOP=1 -1 -f - < file`).
The suites:

```bash
npx supabase test db --db-url "<the pooler URL, password percent-encoded, built from the custody file and never printed>"
```

**13 files, 487 tests, PASS** (69 s; `pgtap-hosted.log`). Not `--linked`: that
path connects as the CLI's own login role (`cli_login_postgres`), which has
neither `extensions` on its search path nor `BYPASSRLS`, so the suites that
count rows as the connection role fail for the wrong reason. The suites now
set `search_path = public, extensions` themselves, so they run wherever
pgTAP is installed in `extensions` (the hosted convention) or in `public`
(the local shim). The committed types match the hosted schema:

```bash
HIVE_DB_URL="<the pooler URL>" node scripts/db-types.mjs check
```

(`db-types-check.log`; the URL travels as libpq variables and is never on a
command line).

## 2. Auth settings (recorded in config.toml; applied in the dashboard)

| Setting                    | Value                                                         | Why                                                     |
| -------------------------- | ------------------------------------------------------------- | ------------------------------------------------------- |
| Sign-ups                   | disabled                                                      | invite-only (`enable_signup = false`)                   |
| Email OTP                  | six digits, one hour, the template with `{{ .Token }}`        | the app enters the code, never follows a link           |
| Code frequency             | one per minute per address; 30 emails per hour                | a real mail path, not the harness's one second          |
| MFA (TOTP)                 | enrollment enabled; verification enabled (the hosted default) | staff AAL2                                              |
| Minimum password length    | 12                                                            | the review code is twelve to twenty digits              |
| Password verification hook | **off** (see below)                                           | a Teams/Enterprise feature; the organization is on Free |
| Site URL, redirects        | the hosted default; none                                      | no link is ever followed                                |

The values live in `supabase/config.toml` under `[remotes.staging]`, which
`supabase config push` merges over the local values for this project ("Loading
config override: [remotes.staging]"). Two facts learned on 2026-09-29 govern
how they reach the project:

1. **`config push` applies without a confirmation prompt** and prints the
   diff it applied. Never run it as a preview.
2. **On this organization the push is refused outright** (HTTP 402: "The
   following auth hooks cannot be configured for this organization:
   HOOK_PASSWORD_VERIFICATION_ATTEMPT"). The platform refuses any auth
   update that names that hook, even with `enabled = false`, and the CLI
   names every hook whether or not `config.toml` mentions it (verified with
   the sections masked). The auth section of the push is therefore closed
   until the plan changes; the API and database sections push fine ("up to
   date").

So the auth values are applied by hand, in the dashboard, from Kody's own
signed-in session (Kody signs in; the settings are driven from that session
and read back), and the dashboard must never hold a value `config.toml`
does not record: **Sign In / Providers**: user sign-ups off; Email provider
on with OTP length 6 and expiry 3600; minimum password length 12, no
character requirements. **Emails**: Magic Link subject "Your HIVE sign-in
code", body exactly `supabase/templates/magic_link.html`. **Rate limits**:
30 emails per hour. Status 2026-09-29, read back from the dashboard after Kody's own clicks
(`security/evidence/2026-09-29-hosted-staging/dashboard-*.jpg`): sign-ups
off, manual linking off, anonymous sign-ins off, confirmations on, minimum
password length 12 with no character requirements, code length 6, expiry 3600. With the SMTP provider of section 3 in place the same day, the email
rate limit reads 30 per hour and the Magic Link template is the code
template, both read back (`dashboard-rate-limits.jpg`,
`dashboard-template-preview.jpg`). Every protected row stays behind RLS
with no membership to grant.

## 3. Email delivery (the recorded HOLD dependency, unchanged)

A custom SMTP provider or an approved Send Email Hook, owned and
reviewed by Honeybee; the default provider is refused for staging and
release (PRODUCT.md). On the Free plan with the default provider,
templates cannot be customized and delivery reaches project-team
addresses only, so the SMTP door precedes any hosted sign-in. Its
settings go into `[remotes.staging.auth.email.smtp]` with `env()` secrets
the moment the provider exists, and into the dashboard by hand while the
push stays closed.

**Chosen 2026-09-29 under Kody's "do the rest": Resend** (free plan: 3,000
emails a month, 100 a day), team `myhbcfo`, domain `myhbcfo.com` added by
this session with receiving left off (its MX record would take Honeybee's
Google mail). The domain is Google Workspace-managed with its zone at
Squarespace, and this session's permission policy refuses DNS changes, so
the three records are Kody's own hand: TXT `resend._domainkey` (Resend's
1024-bit DKIM key), CNAME `rsend` to `rsend.forge.rmta.net`, CNAME `send`
to `send.forge.rmta.net`; nothing existing changes. Then Kody creates a
sending API key in Resend and enters it himself in the dashboard's SMTP
settings: sender `HIVE <hive@myhbcfo.com>`, host `smtp.resend.com`, port
465, username `resend`, password the key, which this session never sees.
The provider sees the recipient address and the code, never client
content.

**Executed 2026-09-29: the domain verified by Resend, the SMTP settings
entered by Kody (read back: sender `HIVE <hive@myhbcfo.com>`, host
`smtp.resend.com`, port 465, a 60-second per-user interval, the password
stored hidden), and the four-step acceptance below PASSED** against
staging through the public sign-in path with the publishable key, with
`kody@myhbcfo.com` as the owned QA recipient (his own address, supplied
by him; not the project-team login). The identity was created from this
session through the Auth Admin API with the secret key held in memory
only, and stays on staging with no membership. The record with every
status code: `security/evidence/2026-09-29-hosted-staging/hosted-otp-acceptance.md`. Acceptance, black-box, before any hosted sign-in is
offered to a real recipient:

1. request a code for an owned QA recipient that is NOT a project-team
   member;
2. the delivered message contains exactly one six-digit token and no
   magic link;
3. sign-in completes by entering that code;
4. an unknown email yields no account and no usable code.

## 4. Origins and keys in the repository (done)

- The project's origin is `profiles.release.approvedOrigins` in
  `security/approved-config.json` and its publishable key is the exact
  `clientKey` (a custom domain or a production project is its own exact
  entry after review).
- The release environment carries `EXPO_PUBLIC_SUPABASE_URL` (that
  origin) and `EXPO_PUBLIC_SUPABASE_CLIENT_KEY` (the publishable key)
  only; `config:check --profile release` now fails on exactly the two
  public contacts (section 7) and nothing else.

## 5. Identities and data

- **Staging carries the SQL-only lane's synthetic seed** (the same rows the
  suites need locally): the placeholder identities have empty password
  hashes and `example.invalid` addresses, so they cannot sign in by any
  path; every row is labelled synthetic. This amends the earlier "no
  synthetic identity on a hosted project" line, for staging only.
- **Production never carries a seed.** Its staff and client identities are
  created by invitation through the Auth Admin API, by Kody, one at a
  time, with their memberships; the seed tooling is loopback-only by
  design and stays so. One exception, decided on 2026-09-30 and ratified
  by Kody the same day (WO-011): the store review tenant, which a reviewer can only reach on
  production. It is one synthetic environment with one review identity,
  seeded through the hosted operator mode at Kody's word ("seed
  production"), isolated from every client by the same row-level security.
- Live data stays HOLD until Kody names it.

## 6. The review tenant

The hook the review tenant relies on (WO-008, option A) is a
**Teams/Enterprise** feature of the hosted platform, not a Free or Pro
one. On staging it is off, nothing holds a password, and the review
identity does not exist. Kody chose the fallback, built as WO-009 the same day
(`docs/plans/2026-09-29-wo-009-review-tenant-fallback.md`): the migration
`20260929120014` is on both hosted projects with its every-minute sweep,
so the review sign-in holds on every plan; the hook returns the day a plan
permits it. Seeding the review tenant, opening a window per submission,
and the review notes are operator steps, run through the hosted operator
mode (WO-011, `scripts/hosted-supabase.mjs`; the commands are in
`review-tenant.md`). It was proven on staging on 2026-09-30: the
black-box path (33 checks), the operator's own sequence with the real
code, and the suites with the tenant present; staging was left retired
(`security/evidence/2026-09-30-hosted-operator/`).

## 7. The public contacts and pages (Kody)

- `EXPO_PUBLIC_SUPPORT_EMAIL`: **`info@myhbcfo.com`** (decided 2026-09-29:
  Honeybee's existing address; the release check passes on it). Kody makes
  `hive@myhbcfo.com`, the sender of the code emails, an alias of that
  account in Google Workspace so replies land in the same place: Google
  Admin, Directory, Users, the `info` account, "Alternate email addresses",
  add `hive`, save (or, if `info` is a group, Groups, the group, Aliases).
- `EXPO_PUBLIC_DELETION_INFO_URL`: **`https://hive.myhbcfo.com/delete-account`**,
  published by Kody on 2026-09-29 from `docs/release/deletion-page.md`;
  read back the same day: the page text, the support address, no link
  but the email (`security/evidence/2026-09-29-hosted-production/site-pages.log`). The zone shows `hive.myhbcfo.com` already served by
  ChatGPT-hosted pages, a natural home for it.
- The privacy policy URL: **`https://hive.myhbcfo.com/privacy`**, published
  by Kody on 2026-09-29 from `docs/release/privacy-policy.md` through the
  ChatGPT project that serves the site (the session's policy refusing to
  publish); counsel approved the standard paragraphs the same day.

**The release environment, complete (2026-09-29):**

```
EXPO_PUBLIC_SUPABASE_URL=https://nceencyvxfhkffbjqlea.supabase.co
EXPO_PUBLIC_SUPABASE_CLIENT_KEY=sb_publishable_lhyWkEiMj9cQkVXFkl9dBw_H_x1K9O_
EXPO_PUBLIC_SUPPORT_EMAIL=info@myhbcfo.com
EXPO_PUBLIC_DELETION_INFO_URL=https://hive.myhbcfo.com/delete-account
```

`config:check --profile release` passes on exactly these four values
(`security/evidence/2026-09-29-hosted-production/config-check-release.log`),
the first time it has. They go into the production build profile the day
the store accounts exist; nothing here is a secret, and the development
configuration in `.env.local` is untouched.

## 8. The kill switch, backups, and the plan

- Who may run `set_service_state` with the hosted service key, and from
  which machine, is written down before the project takes any user.
  **Written 2026-09-30 and ratified by Kody the same day (WO-011):** the switch is run from
  Kody's desktop through `scripts/hosted-supabase.mjs`
  (`service-status`, `pause-service [maintenance|incident]`,
  `resume-service`), by Kody or by a session he has instructed. The
  custody is his Supabase CLI login on that machine: the project's secret
  key is read for one command and kept nowhere. A second operator needs a
  login of their own on the organization, which is his to grant. A pause
  or a resume on production needs the project ref repeated. Drilled on
  staging the same day: paused, read as the app reads it, resumed.
- **Found 2026-09-30, not changed:** both hosted projects still issue the
  legacy `anon` and `service_role` tokens next to the new publishable and
  secret keys. Nothing in HIVE uses the legacy pair: the app holds the
  publishable key, the operator mode requires the new secret key, and the
  CLI uses its own login and the database password. The legacy
  `service_role` token is a long-lived secret that cannot be rotated on
  its own. Recommended: disable the legacy keys on each project in the
  dashboard (API keys page), staging first; a dashboard setting, so
  Kody's click.
- The Free plan has no managed backups and pauses a project after a week
  without traffic; `drill-backup` (pg_dump/pg_restore) remains the only
  restore path on it. The production project needs at least the Pro plan
  for daily backups and no pausing; point-in-time recovery is a further
  add-on. Plan and payment are Kody's decisions.

## 8a. The app on a device against staging (done 2026-09-29, "go device")

The QA identity `kody@myhbcfo.com` holds one membership on staging,
`client_user` on the synthetic entity Harbor Light Bakery LLC (Synthetic)
of client A, inserted as `postgres` through the pooler (the seed tooling
stays loopback-only). Metro was restarted with the staging origin and the
publishable key in its process environment (they take precedence over
`.env.local`), and the served bundle was checked before any launch: the
staging origin once, no loopback address, the publishable key once, no
secret-shaped value. Three scratch Maestro flows then ran on the Pixel_8
emulator: a cleared launch entering the address and requesting a code
(delivered by Resend), the code entered and the scoped dashboard reached,
and the requests list with one request detail, all from the hosted
database (`security/evidence/2026-09-29-hosted-staging/device-0*.png`).
Staging recorded one `aal1` session for the identity. The first attempt
was refused on the device with the "code not accepted" wording while the
gateway log showed no verify request at all and the emulator's runtime
aborted the process seconds later (an ART profile-saver check failure, a
known emulator fault on this desktop); the same code verified from the
host, and the second attempt on the healthy emulator passed. Restore
Metro to the local environment afterwards, as the runbook lane expects.

## 9. The production project (created 2026-09-29, "Help here")

`hive-production`, ref `nceencyvxfhkffbjqlea`, us-east-2, the same
organization, Free plan until Kody upgrades it (section 8). Sections 1 and
4 are done: thirteen migrations by `db push --db-url`, the committed types
matching, no seed of any kind, the release profile of the manifest now
naming its origin and publishable key (`security/evidence/2026-09-29-hosted-production/`).
Its dashboard settings were entered by Kody the same day ("production
set") and read back: sign-ups off, code length 6, minimum password length
12, custom SMTP from `hive@myhbcfo.com` through Resend with the key "HIVE
production", 30 emails per hour, the code template. The four-step
acceptance then PASSED against production and the test identity was
deleted, leaving 0 users
(`security/evidence/2026-09-29-hosted-production/hosted-otp-acceptance.md`).
Still Kody's: the Pro upgrade before any real client, and the first
invitations. `[remotes.production]` in `config.toml` records the values.
Staging stays the review and rehearsal environment.
