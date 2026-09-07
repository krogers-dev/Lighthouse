# Flows after the Metro restart — 2026-09-07, desktop session 2 (continuation)

Head at run time: `f44a200 Record: design evidence on the branch (28 captures), clean prebuild proves the icon and colors; find 44 — restart Metro after a clean prebuild`
Device: emulator-5554 (Pixel_8, API 35), com.myhbcfo.hive.development (the binary built by the clean prebuild recorded in d69ab64; not rebuilt here).
Local stack: Mailpit 127.0.0.1:54324 /api/v1/info → 200.

## STEP 1 — state

- `git fetch` → `d69ab64..f44a200`; `git status` clean; `git pull --ff-only` fast-forwarded to f44a200.
- `adb devices` → `emulator-5554 device`; `sys.boot_completed` → 1; airplane-mode → disabled; `font_scale` → 1.0; `uimode night` → no; package list → `package:com.myhbcfo.hive.development`.
- Listener on 8081 before the change: **PID 40480**, `node.exe`, created 2026-09-06 14:52:58, command line
  `"node" "C:\dev\Lighthouse\hive-app\node_modules\.bin\\..\expo\bin\cli" run:android`
  (the Metro left behind by the earlier `expo run:android`).
- Stall measurement before the restart: `Measure-Command { Invoke-WebRequest http://127.0.0.1:8081/status }` → **15.80 s**.

## STEP 2 — Metro restart (the one authorized process change)

- `Stop-Process -Id 40480 -Force`; after 3 s, `Get-NetTCPConnection -LocalPort 8081 -State Listen` returned nothing (port free).
- Start command (exact):
  ```
  Start-Process -FilePath "cmd.exe" -ArgumentList '/c set CI=1&& set EXPO_PUBLIC_QA_HOOKS=1&& npx expo start --port 8081 > "%TEMP%\hive-metro.log" 2>&1' -WorkingDirectory "C:\dev\Lighthouse\hive-app" -WindowStyle Hidden
  ```
- Readiness: `/status` returned 200 with body `packager-status:running` (PowerShell 5.1 surfaces the body as `Byte[]`; the poll's string match therefore printed "NOT READY" although the server had been up for most of the 180 s — a harness artifact, not a Metro fault; the byte decode confirmed the text).
- `/status` timing after the restart: **0.0065 s**, **0.0071 s** (re-measured), **0.042 s** (end of session).
- New listener: **PID 21012**, `node.exe`, `"node" "C:\dev\Lighthouse\hive-app\node_modules\.bin\\..\expo\bin\cli" start --port 8081`. Left running.
- Warm-up: `am force-stop` + `monkey … LAUNCHER 1` → `Events injected: 1`; after 60 s the uiautomator dump listed `brand-wordmark`. Metro log: `Android Bundled 839ms node_modules\expo-router\entry.js (1688 modules)`.
- Metro log tail at the end of the session (first 10 lines):
```
env: load .env.local
env: export EXPO_PUBLIC_SUPABASE_CLIENT_KEY EXPO_PUBLIC_SUPABASE_URL
Starting project at C:\dev\Lighthouse\hive-app
Metro is running in CI mode, reloads are disabled. Remove CI=true to enable watch mode.
Starting Metro Bundler

Waiting on http://localhost:8081

Logs for your project will appear below.
Android Bundled 839ms node_modules\expo-router\entry.js (1688 modules)

```
  Later lines are the `(1 module)` incremental bundles for each launch, then, during quarantine-recovery, `ERROR Auto refresh tick failed with error … [QuarantineRequiredError: Secure storage requires quarantine: corrupt]` followed by three `Uncaught (in promise, id: 0/1/2) QuarantineRequiredError` entries and `WARN Promise rejection handled (id: 2)`. See observation O-1 below.

## STEP 3 — the four flows (order as instructed; airplane mode checked after each: disabled)

### 1. sign-in (first run) — PASS

Command: `cmd /c "maestro test .maestro/sign-in.yaml 2>&1" | Tee-Object -FilePath "$env:TEMP\hive-signin-r.log"`
`0` = **0**. Final line: `Assert that id: dashboard-workspace is visible... COMPLETED`
Last 30 lines (the log has 17):
```
Running on Pixel_8
 > Flow Invite-only OTP sign-in reaches the scoped dashboard
Launch app "com.myhbcfo.hive.development" with clear state... COMPLETED
Assert that id: sign-in-email is visible... COMPLETED
Assert that id: sign-in-email is visible... COMPLETED
Tap on id: sign-in-email... COMPLETED
Input text client.owner@example.invalid... COMPLETED
Run otp-snapshot.js... COMPLETED
Tap on id: sign-in-submit... COMPLETED
Assert that "Enter your sign-in code" is visible... COMPLETED
Run otp-fetch.js... COMPLETED
Tap on id: otp-code... COMPLETED
Input text ${output.otpCode}... COMPLETED
Tap on id: otp-submit... COMPLETED
Assert that "Choose a workspace" is visible... COMPLETED
Tap on "Harbor Light Bakery LLC \(Synthetic\), Client access"... COMPLETED
Assert that id: dashboard-workspace is visible... COMPLETED
```

### 2. denied — PASS (`maestro:denied OK`)

Command: `cmd /c "npm run maestro:denied 2>&1" | Tee-Object -FilePath "$env:TEMP\hive-denied5.log"`
`0` = **0**. Final line: `maestro:denied OK — signed in, requests listed, membership revoked MID-FLOW, refresh showed the access change with no stale row; membership restored and verified, artifacts confined and removed`
Last 30 lines:
```
Run otp-snapshot.js... COMPLETED
Tap on id: sign-in-submit... COMPLETED
Assert that "Enter your sign-in code" is visible... COMPLETED
Run otp-fetch.js... COMPLETED
Tap on id: otp-code... COMPLETED
Input text ${output.otpCode}... COMPLETED
Tap on id: otp-submit... COMPLETED
Assert that "Choose a workspace" is visible... COMPLETED
Tap on "Harbor Light Bakery LLC \(Synthetic\), Client access"... COMPLETED
Assert that id: dashboard-workspace is visible... COMPLETED
maestro:denied: running read-surfaces-denied.yaml (sequential; artifacts confined to C:\Users\kodyr\AppData\Local\Temp\hive-maestro-denied-FLZDxY; watchdog 600000ms)
Running on Pixel_8
 > Flow Revoked membership denies the read surfaces without showing stale rows
Launch app "com.myhbcfo.hive.development"... COMPLETED
Assert that "Choose a workspace" is visible... COMPLETED
Tap on "Harbor Light Bakery LLC \(Synthetic\), Client access"... COMPLETED
Assert that id: dashboard-workspace is visible... COMPLETED
Tap on id: nav-requests... COMPLETED
Assert that id: requests-list is visible... COMPLETED
Run revoke-membership.js...maestro:denied: membership revoked mid-flow (1 row(s) deleted); readback verified zero
 COMPLETED
Tap on id: requests-refresh... COMPLETED
Assert that id: requests-stale is visible... COMPLETED
Assert that id: requests-list is not visible... COMPLETED
Assert that "Bank statement for the closing month \(Synthetic\)" is not visible... COMPLETED
Assert that "Choose a workspace" is visible... COMPLETED
membership-restore: client.owner@example.invalid on entityA1 restored (1 seeded row(s) present, readback verified)
maestro:denied: membership restored and verified (success)
maestro:denied: artifact tree scrubbed (C:\Users\kodyr\AppData\Local\Temp\hive-maestro-denied-FLZDxY removed and verified gone)
maestro:denied OK — signed in, requests listed, membership revoked MID-FLOW, refresh showed the access change with no stale row; membership restored and verified, artifacts confined and removed
```

### 3. accessibility-smoke — FAIL (flow-ordering defect in the flow file, not an app regression; not retried)

Command: `cmd /c "maestro test .maestro/accessibility-smoke.yaml 2>&1" | Tee-Object -FilePath "$env:TEMP\hive-a11y3.log"`
`0` = **1**. Final line: `C:\Users\kodyr\.maestro\tests\2026-09-07_003517`
Failure was `Assert that "Email" is visible... FAILED` — not an `AndroidDriverTimeoutException`, so the single permitted retry did not apply.
Last 40 lines (the log has 13):
```
Running on Pixel_8
 > Flow Accessibility smoke � labels present on the auth path
Launch app "com.myhbcfo.hive.development"... COMPLETED
Assert that "HIVE" is visible... COMPLETED
Assert that "Email" is visible... FAILED

Assertion is false: "Email" is visible

Assertion '"Email" is visible' failed. Check the UI hierarchy in debug artifacts to verify the element state and properties.

Possible causes:
- Element selector may be incorrect - check if there are similar elements with slightly different names/properties.
- Element may be temporarily unavailable due to loading state
- This could be a real regression that needs to be addressed

==== Debug output (logs & screenshots) ====

C:\Users\kodyr\.maestro\tests\2026-09-07_003517
```
Diagnosis (read-only): `accessibility-smoke.yaml` does `- launchApp` with no `clearState`. The denied lane immediately before it restores the membership and leaves the app signed in, so the launch lands on the workspace chooser. The uiautomator dump taken right after the failure showed `select-scope-screen`, `brand-wordmark` (text `HIVE`), `Choose a workspace`, two `scope-option-*` rows and `scope-sign-out` — so `HIVE` was visible (step passed) and the sign-in `Email` label was not. This is the same class of defect sign-in.yaml already guards against with `launchApp: clearState: true` (its header comment cites the 2026-09-06 desktop run). Proposed find (next after 44): give accessibility-smoke a `clearState: true` launch plus the same bounded `extendedWaitUntil` on `sign-in-email` as sign-in.yaml, or fix the lane order in the runbook. The previous two failures of this flow (driver start-up timeout at ca96181; splash-only at the stalled Metro) had different causes, so this flow has still never passed on this desktop at a v3.0 head.

### 4a. sign-in (second run, ahead of quarantine-recovery) — PASS

Command: `cmd /c "maestro test .maestro/sign-in.yaml 2>&1" | Tee-Object -FilePath "$env:TEMP\hive-signin-q2.log"`
`0` = **0**. Final line: `Assert that id: dashboard-workspace is visible... COMPLETED`
Last 30 lines (the log has 17):
```
Running on Pixel_8
 > Flow Invite-only OTP sign-in reaches the scoped dashboard
Launch app "com.myhbcfo.hive.development" with clear state... COMPLETED
Assert that id: sign-in-email is visible... COMPLETED
Assert that id: sign-in-email is visible... COMPLETED
Tap on id: sign-in-email... COMPLETED
Input text client.owner@example.invalid... COMPLETED
Run otp-snapshot.js... COMPLETED
Tap on id: sign-in-submit... COMPLETED
Assert that "Enter your sign-in code" is visible... COMPLETED
Run otp-fetch.js... COMPLETED
Tap on id: otp-code... COMPLETED
Input text ${output.otpCode}... COMPLETED
Tap on id: otp-submit... COMPLETED
Assert that "Choose a workspace" is visible... COMPLETED
Tap on "Harbor Light Bakery LLC \(Synthetic\), Client access"... COMPLETED
Assert that id: dashboard-workspace is visible... COMPLETED
```

### 4b. quarantine-recovery — PASS

Command: `cmd /c "maestro test .maestro/quarantine-recovery.yaml 2>&1" | Tee-Object -FilePath "$env:TEMP\hive-quarantine3.log"`
`0` = **0**. Final line: `Assert that "Email" is visible... COMPLETED`
Every step COMPLETED, including `Scrolling DOWN until "Reset sign-in on this device" is visible …` and `Tap on "Reset sign-in on this device"`.
Last 30 lines (the log has 18):
```
Running on Pixel_8
 > Flow Storage quarantine blocks protected UI; scrub is the only recovery
Launch app "com.myhbcfo.hive.development"... COMPLETED
Assert that "Choose a workspace" is visible... COMPLETED
Tap on "Harbor Light Bakery LLC \(Synthetic\), Client access"... COMPLETED
Assert that id: dashboard-workspace is visible... COMPLETED
Open hivedev:///?qa=corrupt-storage... COMPLETED
Assert that id: qa-corrupt-ack is visible... COMPLETED
Stop com.myhbcfo.hive.development... COMPLETED
Launch app "com.myhbcfo.hive.development"... COMPLETED
Assert that id: dashboard-workspace is not visible... COMPLETED
Assert that id: quarantine-screen is visible... COMPLETED
Assert that "Sign-in on this device needs a reset" is visible... COMPLETED
Assert that "Retry" is not visible... COMPLETED
Scrolling DOWN until "Reset sign-in on this device" is visible with speed 40, visibility percentage 100%, timeout 20000 ms, with centering disabled... COMPLETED
Tap on "Reset sign-in on this device"... COMPLETED
Assert that "Note: Sign-in on this device was reset\. Sign in again to continue\." is visible... COMPLETED
Assert that "Email" is visible... COMPLETED
```

## Verdicts

| Flow | Verdict | Basis |
|---|---|---|
| sign-in (run 1) | PASS | exit 0, all 15 steps COMPLETED |
| denied (`npm run maestro:denied`) | PASS | exit 0, `maestro:denied OK`, membership restored and verified, artifact tree scrubbed |
| accessibility-smoke | FAIL | exit 1 at `"Email" is visible`; flow launches without `clearState` onto a signed-in chooser (flow defect, proposed find) |
| sign-in (run 2) | PASS | exit 0, all 15 steps COMPLETED |
| quarantine-recovery | PASS | exit 0, all 16 steps COMPLETED incl. scroll-into-view and reset tap |

Net: the Metro restart resolved the stall (find 44 confirmed: /status 15.8 s → 0.007 s; first bundle 839 ms). Three of the four lanes that failed at the stalled Metro now pass at f44a200 on the clean-prebuild binary; accessibility-smoke fails for an unrelated, flow-side reason.

## Observations

- **O-1 (low, app):** during quarantine-recovery Metro logged `Auto refresh tick failed … QuarantineRequiredError` and three `Uncaught (in promise)` `QuarantineRequiredError` rejections from `SessionStorageAdapter#readInternal` (`src\auth\secure-store-adapter.ts:174`), one later reported handled. The UI behaved correctly (quarantine screen shown, protected UI absent, scrub was the only recovery), so this is a dev-log hygiene item: the refresh tick and the readers that race the quarantine transition should catch `QuarantineRequiredError` explicitly rather than leave unhandled rejections. No secret or identity content in the log; only the error class and code `corrupt`.
- **O-2 (harness):** under PowerShell 5.1 `Invoke-WebRequest -UseBasicParsing` returns Metro's `/status` body as `Byte[]`; a readiness poll must decode it (`[Text.Encoding]::ASCII.GetString($r.Content)`) before matching `packager-status:running`.

## STEP 4 — tidiness (end of session)

- `Get-ChildItem $env:TEMP -Directory -Filter 'hive-maestro-*'` → none.
- `Get-NetTCPConnection -LocalPort 8477,8478 -State Listen` → none.
- airplane-mode → disabled; `font_scale` → 1.0; `uimode night` → no.
- Metro PID 21012 left running on 8081; `/status` 0.042 s.
- Nothing outside `security/evidence/` was modified; no rebuild, no `pm clear`, emulator and Docker untouched.
