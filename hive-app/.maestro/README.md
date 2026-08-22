# Maestro flows — HIVE Milestone 0

Critical-path flows for iOS and Android development builds. This
environment has no device or simulator lane, so these are authored,
validated (`npm run maestro:validate`), and reviewed but not yet executed
(device lane HOLD; owner Kody per the PM directives of 2026-08-21).
Run `npm run maestro:validate` again on the QA machine before scheduling
the hardware run — it checks appIds, commands, testID selectors, script
targets, and banned secret channels across every flow.

## Flows

| Flow                       | Covers                                                                                                           |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `sign-in.yaml`             | Invite-only email OTP to the scoped dashboard (multi-membership chooser)                                         |
| `mfa-enroll.yaml`          | First staff login: TOTP enrollment (QR + setup key), derived wrong-code recovery, AAL2                           |
| `mfa-login.yaml`           | Subsequent staff login against the existing factor — never a second QR                                           |
| `scope-switch.yaml`        | Entity switch clears content and rebinds                                                                         |
| `sign-out.yaml`            | Sign-out removes protected UI and survives relaunch                                                              |
| `expired-session.yaml`     | Revoked/expired stored session fails closed into fresh sign-in                                                   |
| `offline.yaml`             | Explicit offline state, no stale content, retry recovery (Android `setAirplaneMode`)                             |
| `quarantine-recovery.yaml` | Storage quarantine blocks protected UI; verified scrub is the only exit (QA-build corruption hook)               |
| `reinstall.yaml`           | Data-cleared/reinstalled app boots clean and scrubs stale secure data first                                      |
| `accessibility-smoke.yaml` | Accessible labels on the auth path (run with the screen reader active)                                           |
| `confinement-probe.yaml`   | Forced failure while the QR/setup key is on screen — proves artifact confinement (`npm run maestro:confinement`) |
| `clipboard-scrub.yaml`     | Cleanup only: overwrites the device clipboard on every runner exit path                                          |

## Prerequisites on a machine with a device lane

1. `node scripts/local-supabase.mjs up` (Docker) and
   `node scripts/local-supabase.mjs seed` for the synthetic users.
2. A development build installed (`npx --no-install expo run:ios` /
   `run:android`). For `quarantine-recovery.yaml` only, the build must be
   exported with `EXPO_PUBLIC_QA_HOOKS=1` (QA build) — that enables the
   dev-only `hivedev://qa/corrupt-storage` hook, which `config:check`
   forbids outside development and `bundle:inspect` proves absent from
   non-development exports.
3. One-time codes arrive in the local Mailpit (http://127.0.0.1:54324) and
   are read MID-FLOW by `otp-snapshot.js` / `otp-fetch.js` — no
   out-of-band `-e OTP_CODE=…` variable. The snapshot script records the
   recipient's existing message ids before the code is requested, and the
   fetch script accepts only a message that arrived afterwards, addressed
   to exactly that synthetic recipient, with the exact subject and exactly
   one distinct six-digit token; anything else leaves `output.otpCode`
   empty so the flow fails loudly instead of typing a stale code.
4. For the TOTP flows, run `node scripts/totp-helper.mjs` (loopback-only)
   and keep the SAME process running across `mfa-enroll.yaml` and
   `mfa-login.yaml`: the enrollment flow copies the on-screen setup key
   once, hands it to the helper's MEMORY in a POST body, and immediately
   overwrites the clipboard. The secret never travels through CLI
   arguments, environment variables, URL parameters, persisted clipboard,
   logs, screenshots, or operator notes; later flows fetch codes by the
   synthetic account label only. Wrong-code attempts use a code that is
   guaranteed wrong across the previous, current, and next accepted time
   windows, never a constant.
5. Before `mfa-enroll.yaml`, reset the reviewer's factors with the
   checked loopback command (seeding does NOT clear factors):
   `node scripts/local-supabase.mjs reset-totp reviewer.rae@example.invalid`.
   It fails unless the listing, every deletion, and a zero-factor
   readback all succeed, so enrollment is repeatable after previous
   successful and failed runs.
6. `expired-session.yaml` has its documented server-side revocation
   pre-step in the flow header.

## Artifact hygiene for the enrollment flow (executable, mandatory)

**Run the enrollment and login flows only through the runner:**

```
npm run maestro:enroll          # reset -> enroll -> sign-out -> login -> revoke
npm run maestro:confinement     # forced-failure confinement proof
```

`scripts/maestro-enroll-runner.mjs` is the single supported entry point.
Earlier revisions of this file gave the hygiene steps as prose AND got the
artifact model wrong: **`--debug-output` does not receive screenshots.** It
carries logs and the command journal. Maestro writes screenshots — including
the failure screenshot that can show the enrollment QR and setup key — to
`--test-output-dir`, or, when that flag is absent, to the default
`~/.maestro/tests/<timestamp>`. Confining only `--debug-output` confined
nothing.

The runner therefore, on every exit path (success, failure, `SIGINT`,
`SIGTERM`, `SIGHUP`):

1. refuses to start unless the Maestro CLI matches the version **and**
   sha256 pinned in `security/hardware-toolchain.json`, and unless the
   installed CLI actually supports both output flags (an unconfinable run
   is refused, never attempted);
2. creates a private mode-0700 run root with **separate** 0700
   directories for `--debug-output` and `--test-output-dir`;
3. snapshots `~/.maestro/tests` before and after every flow and fails on
   any new entry there (default-location leak detection);
4. runs the sequence strictly sequentially — one flow per invocation, no
   sharding flag — as `reset-totp` → `mfa-enroll` → `sign-out` →
   `mfa-login` → `revoke`. The factor is **not** revoked between a
   successful enrollment and the subsequent login: that login is what
   proves the existing factor verifies;
5. starts the loopback `totp-helper` for the whole sequence and kills it
   in cleanup (the setup secret lives only in that process's memory);
6. overwrites the device clipboard via `clipboard-scrub.yaml` (a run that
   dies between "copy the setup key" and "overwrite it" would otherwise
   leave the key on the clipboard);
7. revokes the disposable factor with the checked `reset-totp` command;
8. removes the entire artifact tree and verifies it is gone. Enrollment
   artifacts are discarded unread — **no screenshot containing the QR or
   setup secret is ever retained.** Only the post-secret flows'
   assertions are reported.

`npm run maestro:confinement` runs `confinement-probe.yaml`, which fails
deliberately while the QR and setup key are on screen. The runner asserts
that the resulting screenshot landed inside the private run root, that
nothing appeared in `~/.maestro/tests`, and then scrubs it — the proof is
the assertion, not a retained image.

## Device evidence to capture (beyond flow output)

- The enrollment QR scans successfully in a real authenticator app
  (against a synthetic account; never screenshot the setup screen).
- Screen-reader pass for `accessibility-smoke.yaml`.

All identities are synthetic (`example.invalid`).
