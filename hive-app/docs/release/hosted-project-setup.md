# Hosted project setup (prepared 2026-09-29 under Kody's general grant)

**Status: prepared, not executed. Creating the hosted Supabase project,
choosing its plan, and paying for it are Kody's own actions; this page is
the exact configuration to apply the moment the project exists, in the
order that keeps every local proof true on the hosted stack.** Nothing
here has been run against any hosted project.

## 0. What Kody creates

1. A Supabase project for **staging** (region: Kody's choice; the plan
   must allow a custom SMTP provider or a Send Email Hook, see step 3).
2. Its **publishable key** and its **origin** (`https://<ref>.supabase.co`).
   The service key stays with Kody and the operator machine; it never
   reaches the repository or the app.
3. A controlled mailbox for the review identity (step 6) and the two
   public contacts (step 7).

## 1. Schema and policies

```bash
npx supabase link --project-ref <ref>
```

```bash
npx supabase db push
```

Every migration under `supabase/migrations/` applies in order, including
the release controls (`20260928120012`) and the review tenant
(`20260929120013`). Then run the pgTAP suites against the hosted database
once (`supabase test db --linked`) and keep the output in
`security/evidence/<date>-hosted-staging/`.

## 2. Auth settings (mirror `supabase/config.toml`)

| Setting                    | Value                                                                | Why                                           |
| -------------------------- | -------------------------------------------------------------------- | --------------------------------------------- |
| Sign-ups                   | disabled                                                             | invite-only (`enable_signup = false`)         |
| Email OTP                  | six digits, the local expiry, the local template with `{{ .Token }}` | the app enters the code, never follows a link |
| MFA (TOTP)                 | enrollment enabled; verification enabled                             | staff AAL2                                    |
| Password verification hook | `pg-functions://postgres/app_private/review_password_verification`   | the review tenant (WO-008)                    |
| Minimum password length    | 12                                                                   | the review code is twelve to twenty digits    |
| Rate limits                | the local values                                                     | `[auth.rate_limit]`                           |
| Redirect URLs              | none                                                                 | no links are ever followed                    |

## 3. Email delivery (the recorded HOLD dependency)

A custom SMTP provider or an approved Send Email Hook, owned and
reviewed by Honeybee; the default provider is refused for staging and
release (PRODUCT.md). Acceptance, black-box, before any hosted sign-in
is offered to a real recipient:

1. request a code for an owned QA recipient that is NOT a project-team
   member;
2. the delivered message contains exactly one six-digit token and no
   magic link;
3. sign-in completes by entering that code;
4. an unknown email yields no account and no usable code.

## 4. Origins and keys in the repository

- Add the project's origin to `security/approved-config.json` under
  `profiles.release.approvedOrigins` (an exact origin; custom domains
  need their own explicit entry).
- The release environment carries `EXPO_PUBLIC_SUPABASE_URL` (that
  origin) and `EXPO_PUBLIC_SUPABASE_CLIENT_KEY` (the publishable key)
  only; `config:check --profile release` refuses anything else.

## 5. Identities and data

- No synthetic identity is seeded on a hosted project except the review
  tenant (step 6). Staff and client identities are created by invitation
  through the Auth Admin API, by Kody, one at a time, with their
  memberships; the seed script is loopback-only by design.
- Live data stays HOLD until Kody names it; staging holds synthetic
  content only.

## 6. The review tenant

```bash
node scripts/local-supabase.mjs seed-review
```

is loopback-only; on the hosted project the same rows are inserted by
Kody's operator run of the equivalent SQL (`scripts/lib/review-tenant.mjs`
lists them), the review identity is created with a Honeybee-controlled
address, `register_review_identity` is called with the service key, and
a window is opened per submission with `open_review_window`. The code
lives in Kody's custody file.

## 7. The public contacts and pages

- `EXPO_PUBLIC_SUPPORT_EMAIL`: a real address on Honeybee's domain.
- `EXPO_PUBLIC_DELETION_INFO_URL`: the public page whose content is
  drafted in `docs/release/deletion-page.md`, hosted on Honeybee's site.
- The privacy policy URL: written by Kody and Stacie (with counsel if
  they choose) from `docs/release/privacy-policy-facts.md`; never drafted
  here.

## 8. The kill switch and backups on the hosted project

- Who may run `set_service_state` with the hosted service key, and from
  which machine, is written down before the project takes any user.
- Managed backups and point-in-time recovery are enabled at the plan's
  level and their restore is drilled once with `pg_dump`/`pg_restore`
  exactly as `drill-backup` does locally.
