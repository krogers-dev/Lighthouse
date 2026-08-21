# Maestro flows — HIVE Milestone 0

Critical-path flows for iOS and Android development builds. This
environment has no device or simulator lane, so these are authored and
reviewed but not yet executed (device lane HOLD; owner Kody per the PM
directive of 2026-08-21).

## Flows

| Flow                       | Covers                                                                               |
| -------------------------- | ------------------------------------------------------------------------------------ |
| `sign-in.yaml`             | Invite-only email OTP to the scoped dashboard (multi-membership chooser)             |
| `mfa-enroll.yaml`          | First staff login: TOTP enrollment (QR + setup key), wrong-code recovery, AAL2       |
| `mfa-login.yaml`           | Subsequent staff login against the existing factor — never a second QR               |
| `scope-switch.yaml`        | Entity switch clears content and rebinds                                             |
| `sign-out.yaml`            | Sign-out removes protected UI and survives relaunch                                  |
| `expired-session.yaml`     | Revoked/expired stored session fails closed into fresh sign-in                       |
| `offline.yaml`             | Explicit offline state, no stale content, retry recovery (Android `setAirplaneMode`) |
| `quarantine-recovery.yaml` | Storage quarantine blocks protected UI; verified scrub is the only exit              |
| `reinstall.yaml`           | Data-cleared/reinstalled app boots clean and scrubs stale secure data first          |
| `accessibility-smoke.yaml` | Accessible labels on the auth path (run with the screen reader active)               |

## Prerequisites on a machine with a device lane

1. `node scripts/local-supabase.mjs up` (Docker) and
   `node scripts/local-supabase.mjs seed` for the synthetic users.
2. A development build installed (`npx --no-install expo run:ios` /
   `run:android`).
3. One-time codes arrive in the local Mailpit (http://127.0.0.1:54324);
   pass them per flow: `maestro test -e OTP_CODE=123456 .maestro/sign-in.yaml`.
4. For the TOTP flows, run `node scripts/totp-helper.mjs` (loopback-only)
   — it stands in for the human's authenticator app. `mfa-enroll.yaml`
   copies the on-screen setup key into it; `mfa-login.yaml` takes the
   secret via `-e TOTP_SECRET=…` (recorded by the QA operator during
   enrollment).
5. `expired-session.yaml` and `quarantine-recovery.yaml` have documented
   pre-steps in their headers (server-side revocation; secure-storage
   invalidation).

All identities are synthetic (`example.invalid`). Never screenshot the
TOTP setup screen; setup keys belong only to synthetic QA accounts and the
loopback helper.
