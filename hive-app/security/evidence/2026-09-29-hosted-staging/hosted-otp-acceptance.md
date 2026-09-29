# Hosted OTP acceptance on staging — 2026-09-29

The four-step acceptance PRODUCT.md and `docs/release/hosted-project-setup.md`
§3 require before any hosted sign-in is offered to a real recipient, run
black-box against `https://zhdvmllscjyepwucbtzq.supabase.co` with the
publishable key, exactly the calls the app makes. Kody supplied the QA
address in writing ("kody@myhbcfo.com"); it is his own mailbox on
Honeybee's domain and not the project-team login. The identity was created
through the Auth Admin API from this session with the project's secret
key held in shell memory only (never printed, never written).

| Step | What happened                                                                                                                   | Result                                                                                                   |
| ---- | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 0    | `POST /auth/v1/admin/users` `{email, email_confirm: true}`                                                                      | HTTP 200; one confirmed identity, no membership, no password known to anyone                             |
| 1    | `POST /auth/v1/otp` `{email, create_user: false}` with the publishable key (18:50:27 UTC)                                        | HTTP 200 `{}`; Resend: Sent and Delivered 12:50 PM local — `resend-email-delivered.jpg`                    |
| 2    | The delivered message, read from Resend's log (HTML tab)                                                                        | From `"HIVE" <hive@myhbcfo.com>`, subject "Your HIVE sign-in code", one six-digit code, no `<a` anywhere |
| 3    | `POST /auth/v1/verify` `{type: "email", email, token}` with that code                                                           | HTTP 200: a bearer session for the address, `aud` authenticated, 3600 s; then `POST /auth/v1/logout?scope=global` HTTP 204; the session file deleted; the same code again HTTP 403 `otp_expired` |
| 4    | `POST /auth/v1/otp` for `nobody.qa.2026@myhbcfo.com`, then `POST /auth/v1/verify` with a guessed code for it                     | HTTP 422 `otp_disabled` ("Signups not allowed for otp"), then HTTP 403 `otp_expired`; `auth.users` holds no row for it |

Database read after the run (as `postgres` through the pooler): 10 users
(the nine synthetic placeholders and the QA identity), the QA identity
confirmed with zero memberships, no row for the unknown address.

## What this proves

- A real recipient outside the project team receives the sign-in code
  through Honeybee's own domain, with the code and no link.
- The code signs the person in through the same endpoint the app calls,
  once; replay is refused.
- An address that is not invited gets no account and nothing usable.

## What this does not prove

- The app on a device against staging: the QA identity has no membership
  yet, so the app would land on its no-access state; giving it a
  synthetic scope is a separate, recorded step.
- Anything about the production project, which does not exist.
