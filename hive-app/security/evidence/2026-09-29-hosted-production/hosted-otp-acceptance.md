# Hosted OTP acceptance on production — 2026-09-29

The same four-step acceptance staging passed earlier the same day, run
black-box against `https://nceencyvxfhkffbjqlea.supabase.co` with the
production publishable key, exactly the calls the app makes, after Kody
entered the production dashboard's auth settings, the SMTP settings with
a second Resend key named "HIVE production", and the code template
("production set"), all read back first (`dashboard-*.jpg`). The test
identity was Kody's own address, supplied by him for the staging run and
reused here with his "production set"; it was created through the Auth
Admin API with the secret key held in shell memory only, and **deleted
afterwards**, so production holds no account until Kody invites the
first real one.

| Step | What happened                                                                                              | Result                                                                                                                                 |
| ---- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | `POST /auth/v1/admin/users` `{email, email_confirm: true}`                                                 | HTTP 200; one confirmed identity, no membership                                                                                        |
| 1    | `POST /auth/v1/otp` `{email, create_user: false}` with the publishable key (21:04:02 UTC)                   | HTTP 200 `{}`; Resend: Sent and Delivered 3:04 PM local, from `"HIVE" <hive@myhbcfo.com>`, subject "Your HIVE sign-in code"             |
| 2    | The delivered message, read from Resend's log (HTML tab)                                                   | one six-digit code, no `<a` anywhere                                                                                                   |
| 3    | `POST /auth/v1/verify` `{type: "email", email, token}` with that code                                      | HTTP 200: a bearer session, `aud` authenticated, 3600 s; then `POST /auth/v1/logout?scope=global` HTTP 204; the same code again HTTP 403 `otp_expired` |
| 4    | `POST /auth/v1/otp` for `nobody.qa.2026@myhbcfo.com`, then `POST /auth/v1/verify` with a guessed code      | HTTP 422 `otp_disabled`, then HTTP 403 `otp_expired`                                                                                   |
| 5    | `DELETE /auth/v1/admin/users/{id}` for the test identity                                                   | HTTP 200                                                                                                                               |

State read as `postgres` through the pooler after the run: 0 users,
0 sessions, 0 one-time tokens, 0 memberships.

## What this proves

- Production delivers the sign-in code through Honeybee's own domain,
  with the code and no link, and the code signs in once through the same
  endpoint the app calls.
- An address that is not invited gets no account and nothing usable.
- Production is empty of accounts and data after the proof.

## What this does not prove

- The app on a device against production: nothing to sign in as, by
  design, until Kody invites the first staff identity.
- The paid plan's backups: the project is on the Free plan until Kody
  upgrades it (the runbook §8).
