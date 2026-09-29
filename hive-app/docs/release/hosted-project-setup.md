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
30 emails per hour. Status 2026-09-29: Kody signed in to the dashboard; the session's own
permission policy refuses to change a hosted project's settings, so the
clicks are Kody's, from this list, with the tab open at Sign In / Providers;
until then the project still has its defaults (sign-ups enabled, a link
template), which admit nothing: anonymous sign-ins are off, confirmations
are on, no delivery reaches anyone outside the project team, and every
protected row is behind RLS with no membership to grant.

## 3. Email delivery (the recorded HOLD dependency, unchanged)

A custom SMTP provider or an approved Send Email Hook, owned and
reviewed by Honeybee; the default provider is refused for staging and
release (PRODUCT.md). On the Free plan with the default provider,
templates cannot be customized and delivery reaches project-team
addresses only, so the SMTP door precedes any hosted sign-in. Its
settings go into `[remotes.staging.auth.email.smtp]` with `env()` secrets
the moment the provider exists, and into the dashboard by hand while the
push stays closed. Acceptance, black-box, before any hosted sign-in is
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
  design and stays so.
- Live data stays HOLD until Kody names it.

## 6. The review tenant

The hook the review tenant relies on (WO-008, option A) is a
**Teams/Enterprise** feature of the hosted platform, not a Free or Pro
one. On staging it is off, nothing holds a password, and the review
identity does not exist. The options are recorded in
`docs/plans/2026-09-29-wo-008-review-tenant.md` (open finding of
2026-09-29): the plan that permits the hook, or the fallback in which the
window tooling alone sets and scrambles the review identity's password and
a scheduled sweep scrambles it at expiry, with the hook re-enabled the day
the plan permits it. Until Kody decides, `seed-review` and the windows
stay local.

## 7. The public contacts and pages (Kody)

- `EXPO_PUBLIC_SUPPORT_EMAIL`: a real address on Honeybee's domain.
- `EXPO_PUBLIC_DELETION_INFO_URL`: the public page whose content is
  drafted in `docs/release/deletion-page.md`, hosted on Honeybee's site.
- The privacy policy URL: written by Kody and Stacie (with counsel if
  they choose) from `docs/release/privacy-policy-facts.md`; never drafted
  here.

## 8. The kill switch, backups, and the plan

- Who may run `set_service_state` with the hosted service key, and from
  which machine, is written down before the project takes any user.
- The Free plan has no managed backups and pauses a project after a week
  without traffic; `drill-backup` (pg_dump/pg_restore) remains the only
  restore path on it. The production project needs at least the Pro plan
  for daily backups and no pausing; point-in-time recovery is a further
  add-on. Plan and payment are Kody's decisions.

## 9. For the production project

Repeat sections 1, 2, 4, and 7 with a new `[remotes.production]` block and
its own exact origin and key, no seed of any kind (section 5), the SMTP
provider of section 3, and the plan of section 8; keep the staging
project as the review and rehearsal environment.
