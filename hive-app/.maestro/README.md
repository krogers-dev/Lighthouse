# Maestro flows — HIVE Milestone 0

Critical-path flows for iOS and Android development builds. This
environment has no device or simulator lane, so these are authored,
validated (`npm run maestro:validate`), and reviewed but not yet executed
(device lane HOLD; owner Kody per the PM directives of 2026-08-21).
Run `npm run maestro:validate` again on the QA machine before scheduling
the hardware run — it checks appIds, commands, testID selectors, script
targets, and banned secret channels across every flow.

## Flows

| Flow                       | Covers                                                                                             |
| -------------------------- | -------------------------------------------------------------------------------------------------- |
| `sign-in.yaml`             | Invite-only email OTP to the scoped dashboard (multi-membership chooser)                           |
| `mfa-enroll.yaml`          | First staff login: TOTP enrollment (QR + setup key), derived wrong-code recovery, AAL2             |
| `mfa-login.yaml`           | Subsequent staff login against the existing factor — never a second QR                             |
| `scope-switch.yaml`        | Entity switch clears content and rebinds                                                           |
| `sign-out.yaml`            | Sign-out removes protected UI and survives relaunch                                                |
| `expired-session.yaml`     | Revoked/expired stored session fails closed into fresh sign-in                                     |
| `offline.yaml`             | Explicit offline state, no stale content, retry recovery (Android `setAirplaneMode`)               |
| `quarantine-recovery.yaml` | Storage quarantine blocks protected UI; verified scrub is the only exit (QA-build corruption hook) |
| `reinstall.yaml`           | Data-cleared/reinstalled app boots clean and scrubs stale secure data first                        |
| `accessibility-smoke.yaml` | Accessible labels on the auth path (run with the screen reader active)                             |

## Prerequisites on a machine with a device lane

1. `node scripts/local-supabase.mjs up` (Docker) and
   `node scripts/local-supabase.mjs seed` for the synthetic users.
2. A development build installed (`npx --no-install expo run:ios` /
   `run:android`). For `quarantine-recovery.yaml` only, the build must be
   exported with `EXPO_PUBLIC_QA_HOOKS=1` (QA build) — that enables the
   dev-only `hivedev://qa/corrupt-storage` hook, which `config:check`
   forbids outside development and `bundle:inspect` proves absent from
   non-development exports.
3. One-time codes arrive in the local Mailpit (http://127.0.0.1:54324);
   pass them per flow: `maestro test -e OTP_CODE=123456 .maestro/sign-in.yaml`.
4. For the TOTP flows, run `node scripts/totp-helper.mjs` (loopback-only)
   and keep the SAME process running across `mfa-enroll.yaml` and
   `mfa-login.yaml`: the enrollment flow copies the on-screen setup key
   once, hands it to the helper's MEMORY in a POST body, and immediately
   overwrites the clipboard. The secret never travels through CLI
   arguments, environment variables, URL parameters, persisted clipboard,
   logs, screenshots, or operator notes; later flows fetch codes by the
   synthetic account label only. Wrong-code attempts use a code DERIVED
   from the real one, never a constant.
5. `expired-session.yaml` has its documented server-side revocation
   pre-step in the flow header.

## Device evidence to capture (beyond flow output)

- The enrollment QR scans successfully in a real authenticator app
  (against a synthetic account; never screenshot the setup screen).
- Screen-reader pass for `accessibility-smoke.yaml`.

All identities are synthetic (`example.invalid`).
