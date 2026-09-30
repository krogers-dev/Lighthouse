# Full 18-flow device lane at the head carrying finds 40 to 45

Date: 2026-09-07 (desktop 2, Kody's Windows desktop, emulator-5554 Pixel 8 API 35).
Git head: `bd2be6c9732e4a90e0ffe5e6f69dc0f454a16b5a` — "Find 45: accessibility-smoke launches from a cleared state with a bounded wait; Metro-restart run recorded (finds 40 to 42 device-confirmed, find 46 owed)".
Binary: com.myhbcfo.hive.development (clean-prebuild build already installed; no rebuild, prebuild, Metro restart, emulator restart, or `pm clear` in this session).
Metro: node PID 21012 on 8081 (started earlier with CI=1 and EXPO_PUBLIC_QA_HOOKS=1), left running.
Synthetic data only. No token, secret, TOTP key, QR, or clipboard content appears below; only runner lines, Maestro step lines, and error/stack lines.

## STEP 1 — State check and pull (verbatim)

```
> git fetch origin claude/hive-fable-5-greenfield-p0cwkq; git status; git pull --ff-only; git log --oneline -1
From https://github.com/krogers-dev/Lighthouse
 * branch            claude/hive-fable-5-greenfield-p0cwkq -> FETCH_HEAD
   07b1372..bd2be6c  claude/hive-fable-5-greenfield-p0cwkq -> origin/claude/hive-fable-5-greenfield-p0cwkq
On branch claude/hive-fable-5-greenfield-p0cwkq
Your branch is behind 'origin/claude/hive-fable-5-greenfield-p0cwkq' by 1 commit, and can be fast-forwarded.
nothing to commit, working tree clean
Updating 07b1372..bd2be6c
Fast-forward
 hive-app/.maestro/accessibility-smoke.yaml         | 12 ++++-
 .../2026-08-22-milestone1-read-only-dashboard.md   | 60 ++++++++++++++++++++++
 2 files changed, 71 insertions(+), 1 deletion(-)
bd2be6c Find 45: accessibility-smoke launches from a cleared state with a bounded wait; Metro-restart run recorded (finds 40 to 42 device-confirmed, find 46 owed)

> Select-String -Path .maestro\accessibility-smoke.yaml -Pattern "clearState: true"
.maestro\accessibility-smoke.yaml:13:    clearState: true

> adb devices
emulator-5554	device
> adb shell getprop sys.boot_completed
1
> adb shell cmd package list packages com.myhbcfo
package:com.myhbcfo.hive.development
> adb shell cmd connectivity airplane-mode
disabled
> adb shell settings get system font_scale
1.0
> adb shell cmd uimode night
Night mode: no

> Get-NetTCPConnection -LocalPort 8081 -State Listen | Select-Object -First 1 OwningProcess
OwningProcess 21012
> Measure-Command { Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8081/status } | Select-Object -ExpandProperty TotalSeconds
0.042213
> (Invoke-WebRequest -UseBasicParsing http://127.0.0.1:54324/api/v1/info).StatusCode
200
> Get-ChildItem $env:TEMP -Directory -Filter 'hive-maestro-*'
(nothing)
> Get-NetTCPConnection -LocalPort 8477,8478 -State Listen -ErrorAction SilentlyContinue
(nothing)
```

Head was already newer than 07b1372 on the first fetch; no wait/retry was needed.

## STEP 2 — The three runners

Each command: `cmd /c "npm run maestro:<name> 2>&1" | Tee-Object -FilePath "$env:TEMP\<log>"`. Exit codes were read into a variable immediately after each command. After each runner: airplane-mode `disabled`, no `hive-maestro-*` directory in TEMP, no listener on 8477/8478 (all three runners).

### maestro:enroll — log hive-enroll5.log — exit code 1 — FAIL
Final runner line: `maestro:enroll FAILED — mfa-enroll.yaml exited 1` (no `maestro:enroll OK`). Failed step: `Tap on id: mfa-code-label... FAILED` / `Element not found: Id matching regex: mfa-code-label`, immediately after `Input text ${output.totpWrongCode}`. The runner's cleanup ran to completion: clipboard overwritten, factor revoked and verified clean, artifact tree scrubbed and verified gone. Because the runner stopped at mfa-enroll.yaml, staff-sign-out.yaml and mfa-login.yaml did not run.
Last 40 lines:
```
Tap on id: sign-in-submit... COMPLETED
Assert that "Enter your sign-in code" is visible... COMPLETED
Run otp-fetch.js... COMPLETED
Tap on id: otp-code... COMPLETED
Input text ${output.otpCode}... COMPLETED
Tap on id: otp-submit... COMPLETED
Assert that "Set up your authenticator" is visible... COMPLETED
Assert that id: mfa-enroll-qr is visible... COMPLETED
Assert that id: mfa-enroll-secret is visible... COMPLETED
Copy text from element with id: mfa-enroll-secret... COMPLETED
Run totp-capture.js...totp-helper: captured factor for reviewer.rae@example.invalid (secret held in memory only)
 COMPLETED
Copy text from element with "Set up your authenticator"... COMPLETED
Tap on id: mfa-code... COMPLETED
Input text ${output.totpWrongCode}... COMPLETED
Tap on id: mfa-code-label... FAILED

Element not found: Id matching regex: mfa-code-label

Element with Id matching regex: mfa-code-label not found. Check the UI hierarchy in debug artifacts to verify if the element exists.

Possible causes:
- Element selector may be incorrect - check if there are similar elements with slightly different names/properties.
- Element may be temporarily unavailable due to loading state.
- This could be a real regression that needs to be addressed.

==== Debug output (logs & screenshots) ====

C:\Users\kodyr\AppData\Local\Temp\hive-maestro-enroll-iX4cK9\artifacts\2026-09-07_004736
maestro:enroll FAILED — mfa-enroll.yaml exited 1
maestro:enroll: totp-helper terminated (in-memory secret discarded)
Running on Pixel_8
 > Flow Overwrite the device clipboard with harmless text
Launch app "com.myhbcfo.hive.development" with clear state... COMPLETED
Assert that id: sign-in-email is visible... COMPLETED
Copy text from element with "HIVE"... COMPLETED
maestro:enroll: device clipboard overwritten (process exit)
reset-totp: reviewer.rae@example.invalid is factor-clean (1 deleted, readback verified zero)
maestro:enroll: factor revoked and verified clean (process exit)
maestro:enroll: artifact tree scrubbed (C:\Users\kodyr\AppData\Local\Temp\hive-maestro-enroll-iX4cK9 removed and verified gone)
```

### maestro:confinement — log hive-confinement4.log — exit code 0 — PASS
Final runner line: `maestro:enroll CONFINEMENT PROOF OK — the QR-bearing failure artifact was confined to the private run root and is now scrubbed (no such screenshot is retained)`.
Last 30 lines:
```
Tap on id: otp-submit... COMPLETED
Assert that "Set up your authenticator" is visible... COMPLETED
Assert that id: mfa-enroll-qr is visible... COMPLETED
Assert that id: mfa-enroll-secret is visible... COMPLETED
Assert that "HIVE CONFINEMENT PROBE � no screen contains this text" is visible... FAILED

Assertion is false: "HIVE CONFINEMENT PROBE � no screen contains this text" is visible

Assertion '"HIVE CONFINEMENT PROBE � no screen contains this text" is visible' failed. Check the UI hierarchy in debug artifacts to verify the element state and properties.

Possible causes:
- Element selector may be incorrect - check if there are similar elements with slightly different names/properties.
- Element may be temporarily unavailable due to loading state
- This could be a real regression that needs to be addressed

==== Debug output (logs & screenshots) ====

C:\Users\kodyr\AppData\Local\Temp\hive-maestro-enroll-Hx3NkR\artifacts\2026-09-07_004900
maestro:enroll: confinement proof — 7 artifact(s) captured, 1 screenshot(s), ALL inside C:\Users\kodyr\AppData\Local\Temp\hive-maestro-enroll-Hx3NkR; none in C:\Users\kodyr\.maestro\tests
maestro:enroll: totp-helper terminated (in-memory secret discarded)
Running on Pixel_8
 > Flow Overwrite the device clipboard with harmless text
Launch app "com.myhbcfo.hive.development" with clear state... COMPLETED
Assert that id: sign-in-email is visible... COMPLETED
Copy text from element with "HIVE"... COMPLETED
maestro:enroll: device clipboard overwritten (confinement proof)
reset-totp: reviewer.rae@example.invalid is factor-clean (1 deleted, readback verified zero)
maestro:enroll: factor revoked and verified clean (confinement proof)
maestro:enroll: artifact tree scrubbed (C:\Users\kodyr\AppData\Local\Temp\hive-maestro-enroll-Hx3NkR removed and verified gone)
maestro:enroll CONFINEMENT PROOF OK — the QR-bearing failure artifact was confined to the private run root and is now scrubbed (no such screenshot is retained)
```

### maestro:denied — log hive-denied6.log — exit code 0 — PASS
Final runner line: `maestro:denied OK — signed in, requests listed, membership revoked MID-FLOW, refresh showed the access change with no stale row; membership restored and verified, artifacts confined and removed`.
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
maestro:denied: running read-surfaces-denied.yaml (sequential; artifacts confined to C:\Users\kodyr\AppData\Local\Temp\hive-maestro-denied-jQ8XFO; watchdog 600000ms)
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
maestro:denied: artifact tree scrubbed (C:\Users\kodyr\AppData\Local\Temp\hive-maestro-denied-jQ8XFO removed and verified gone)
maestro:denied OK — signed in, requests listed, membership revoked MID-FLOW, refresh showed the access change with no stale row; membership restored and verified, artifacts confined and removed
```

## STEP 3 — The fifteen sweep runs (twelve distinct flows)

Each command: `cmd /c "maestro test .maestro/<flow>.yaml 2>&1" | Tee-Object -FilePath "$env:TEMP\hive-sweep5-<NN>-<flow>.log"`. PASS is exit 0 with every step COMPLETED. After every run `adb shell cmd connectivity airplane-mode` reported `disabled`; airplane mode never needed disabling by hand (flows 03, 05 and 07 disable it themselves). No sign-in run needed a retry; no other flow was retried.

### 01 sign-in — log hive-sweep5-01-sign-in.log — exit code 0 — PASS
Final step line: `Assert that id: dashboard-workspace is visible... COMPLETED`
Last 30 lines:
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

### 02 requests — log hive-sweep5-02-requests.log — exit code 0 — PASS
Final step line: `Assert that id: requests-list is visible... COMPLETED`
Last 30 lines:
```
Running on Pixel_8
 > Flow Requests list and detail are read-only within the selected scope
Launch app "com.myhbcfo.hive.development"... COMPLETED
Assert that "Choose a workspace" is visible... COMPLETED
Tap on "Harbor Light Bakery LLC \(Synthetic\), Client access"... COMPLETED
Assert that id: dashboard-workspace is visible... COMPLETED
Tap on id: nav-requests... COMPLETED
Assert that id: requests-screen is visible... COMPLETED
Assert that id: requests-list is visible... COMPLETED
Assert that "Bank statement for the closing month \(Synthetic\)" is visible... COMPLETED
Assert that "Confirm the vehicle expense category \(Synthetic\)" is visible... COMPLETED
Assert that "Quarterly packet source documents \(Synthetic\)" is not visible... COMPLETED
Assert that "Entity setup documents \(Synthetic\)" is not visible... COMPLETED
Assert that "Respond" is not visible... COMPLETED
Assert that "Upload" is not visible... COMPLETED
Tap on "Bank statement for the closing month \(Synthetic\)"... COMPLETED
Assert that id: request-detail-ready is visible... COMPLETED
Assert that "The final month statement is needed to complete the records \(Synthetic\)." is visible... COMPLETED
Assert that "Respond" is not visible... COMPLETED
Scrolling DOWN until id: request-detail-back is visible with speed 40, visibility percentage 100%, timeout 20000 ms, with centering disabled... COMPLETED
Tap on id: request-detail-back... COMPLETED
Assert that id: requests-list is visible... COMPLETED
```

### 03 activity-and-help — log hive-sweep5-03-activity-and-help.log — exit code 0 — PASS
Final step line: `Disable airplane mode... COMPLETED`
Last 30 lines:
```
Running on Pixel_8
 > Flow Activity shows roles and dates only; Help works without the server
Launch app "com.myhbcfo.hive.development"... COMPLETED
Assert that "Choose a workspace" is visible... COMPLETED
Tap on "Harbor Light Bakery LLC \(Synthetic\), Client access"... COMPLETED
Assert that id: dashboard-workspace is visible... COMPLETED
Tap on id: nav-activity... COMPLETED
Assert that id: activity-screen is visible... COMPLETED
Assert that id: activity-list is visible... COMPLETED
Assert that "Request opened" is visible... COMPLETED
Assert that "Status changed" is visible... COMPLETED
Assert that "client.owner@example.invalid" is not visible... COMPLETED
Assert that "reviewer.rae@example.invalid" is not visible... COMPLETED
Enable airplane mode... COMPLETED
Tap on id: nav-help... COMPLETED
Assert that id: help-screen is visible... COMPLETED
Assert that id: help-section-what-hive-shows is visible... COMPLETED
Scrolling DOWN until id: help-version is visible with speed 40, visibility percentage 100%, timeout 20000 ms, with centering disabled... COMPLETED
Assert that id: help-version is visible... COMPLETED
Disable airplane mode... COMPLETED
```

### 04 nav-persistence — log hive-sweep5-04-nav-persistence.log — exit code 0 — PASS
Final step line: `Assert that id: nav-account is visible... COMPLETED`
Last 30 lines:
```
Running on Pixel_8
 > Flow The five destinations are peers � the nav survives arriving at each one
Launch app "com.myhbcfo.hive.development"... COMPLETED
Assert that "Choose a workspace" is visible... COMPLETED
Tap on "Harbor Light Bakery LLC \(Synthetic\), Client access"... COMPLETED
Assert that id: dashboard-workspace is visible... COMPLETED
Assert that id: nav-account is visible... COMPLETED
Tap on id: nav-requests... COMPLETED
Assert that id: requests-screen is visible... COMPLETED
Assert that id: nav-home is visible... COMPLETED
Assert that id: nav-account is visible... COMPLETED
Tap on id: nav-activity... COMPLETED
Assert that id: activity-screen is visible... COMPLETED
Assert that id: nav-home is visible... COMPLETED
Assert that id: nav-account is visible... COMPLETED
Tap on id: nav-help... COMPLETED
Assert that id: help-screen is visible... COMPLETED
Assert that id: nav-home is visible... COMPLETED
Assert that id: nav-account is visible... COMPLETED
Tap on id: nav-account... COMPLETED
Assert that id: settings-screen is visible... COMPLETED
Assert that id: nav-home is visible... COMPLETED
Assert that id: nav-requests is visible... COMPLETED
Assert that id: nav-activity is visible... COMPLETED
Assert that id: nav-help is visible... COMPLETED
Scrolling DOWN until id: settings-back is visible with speed 40, visibility percentage 100%, timeout 20000 ms, with centering disabled... COMPLETED
Tap on id: settings-back... COMPLETED
Assert that id: help-screen is visible... COMPLETED
Assert that id: nav-account is visible... COMPLETED
```

### 05 read-surfaces-offline — log hive-sweep5-05-read-surfaces-offline.log — exit code 0 — PASS
Final step line: `Assert that "Bank statement for the closing month \(Synthetic\)" is visible... COMPLETED`
Last 30 lines:
```
Running on Pixel_8
 > Flow Offline replaces read-surface content rather than ageing it
Launch app "com.myhbcfo.hive.development"... COMPLETED
Assert that "Choose a workspace" is visible... COMPLETED
Tap on "Harbor Light Bakery LLC \(Synthetic\), Client access"... COMPLETED
Assert that id: dashboard-workspace is visible... COMPLETED
Tap on id: nav-requests... COMPLETED
Assert that id: requests-list is visible... COMPLETED
Assert that "Bank statement for the closing month \(Synthetic\)" is visible... COMPLETED
Enable airplane mode... COMPLETED
Tap on id: requests-refresh... COMPLETED
Assert that id: requests-offline is visible... COMPLETED
Assert that id: requests-list is not visible... COMPLETED
Assert that "Bank statement for the closing month \(Synthetic\)" is not visible... COMPLETED
Assert that id: requests-recorded-through is not visible... COMPLETED
Tap on id: nav-activity... COMPLETED
Assert that id: activity-offline is visible... COMPLETED
Assert that id: activity-list is not visible... COMPLETED
Disable airplane mode... COMPLETED
Tap on id: nav-requests... COMPLETED
Assert that id: requests-list is visible... COMPLETED
Assert that "Bank statement for the closing month \(Synthetic\)" is visible... COMPLETED
```

### 06 scope-switch — log hive-sweep5-06-scope-switch.log — exit code 0 — PASS
Final step line: `Assert that "2025 books close \(Synthetic\)" is not visible... COMPLETED`
Last 30 lines:
```
Running on Pixel_8
 > Flow Entity switch clears content and rebinds the dashboard
Launch app "com.myhbcfo.hive.development"... COMPLETED
Assert that "Choose a workspace" is visible... COMPLETED
Tap on "Harbor Light Bakery LLC \(Synthetic\), Client access"... COMPLETED
Assert that id: dashboard-workspace is visible... COMPLETED
Tap on id: nav-account... COMPLETED
Assert that id: settings-screen is visible... COMPLETED
Scrolling DOWN until id: settings-switch-scope is visible with speed 40, visibility percentage 100%, timeout 20000 ms, with centering disabled... COMPLETED
Tap on id: settings-switch-scope... COMPLETED
Assert that "Choose a workspace" is visible... COMPLETED
Assert that "2025 books close \(Synthetic\)" is not visible... COMPLETED
Tap on "Harbor Light Bakery LLC \(Synthetic\), Harbor Light Holdings LLC \(Synthetic\), Client access"... COMPLETED
Assert that id: dashboard-workspace is visible... COMPLETED
Assert that "Nothing needs your attention" is visible... COMPLETED
Assert that "2025 books close \(Synthetic\)" is not visible... COMPLETED
```

### 07 offline — log hive-sweep5-07-offline.log — exit code 0 — PASS
Final step line: `Assert that id: dashboard-workspace is visible... COMPLETED`
Last 30 lines:
```
Running on Pixel_8
 > Flow Offline shows the explicit offline state and recovers on retry (Android lane)
Launch app "com.myhbcfo.hive.development"... COMPLETED
Assert that "Choose a workspace" is visible... COMPLETED
Tap on "Harbor Light Bakery LLC \(Synthetic\), Client access"... COMPLETED
Assert that id: dashboard-workspace is visible... COMPLETED
Enable airplane mode... COMPLETED
Tap on id: nav-account... COMPLETED
Assert that id: settings-screen is visible... COMPLETED
Press back... COMPLETED
Assert that id: dashboard-workspace is visible... COMPLETED
Tap on id: nav-account... COMPLETED
Assert that id: settings-screen is visible... COMPLETED
Scrolling DOWN until id: settings-switch-scope is visible with speed 40, visibility percentage 100%, timeout 20000 ms, with centering disabled... COMPLETED
Tap on id: settings-switch-scope... COMPLETED
Assert that "Choose a workspace" is visible... COMPLETED
Tap on "Harbor Light Bakery LLC \(Synthetic\), Client access"... COMPLETED
Assert that "You are offline" is visible... COMPLETED
Disable airplane mode... COMPLETED
Tap on "Check connection"... COMPLETED
Assert that id: dashboard-workspace is visible... COMPLETED
```

### 08 sign-out — log hive-sweep5-08-sign-out.log — exit code 0 — PASS
Final step line: `Assert that id: dashboard-workspace is not visible... COMPLETED`
Last 30 lines:
```
Running on Pixel_8
 > Flow Sign-out removes protected UI and survives relaunch signed out
Launch app "com.myhbcfo.hive.development"... COMPLETED
Assert that "Choose a workspace" is visible... COMPLETED
Tap on "Harbor Light Bakery LLC \(Synthetic\), Client access"... COMPLETED
Assert that id: dashboard-workspace is visible... COMPLETED
Tap on id: nav-account... COMPLETED
Assert that id: settings-screen is visible... COMPLETED
Scrolling DOWN until id: settings-sign-out is visible with speed 40, visibility percentage 100%, timeout 20000 ms, with centering disabled... COMPLETED
Tap on id: settings-sign-out... COMPLETED
Assert that id: sign-in-email is visible... COMPLETED
Stop com.myhbcfo.hive.development... COMPLETED
Launch app "com.myhbcfo.hive.development"... COMPLETED
Assert that id: sign-in-email is visible... COMPLETED
Assert that id: dashboard-workspace is not visible... COMPLETED
```

### 09 reinstall — log hive-sweep5-09-reinstall.log — exit code 1 — FAIL
Final step line: `Assert that id: sign-in-email is visible... FAILED (debug output C:\Users\kodyr\.maestro\tests\2026-09-07_005651)`
The flow's first assertion (a 30 s `extendedWaitUntil` for `sign-in-email` after `launchApp clearState: true`) timed out. The Maestro debug screenshot at that step shows the Android launcher (the app was no longer in the foreground). The device logcat captured by Maestro records a native crash in the app process half a second after the JS bundle started:
```
09-07 00:57:00.199 I/ReactNativeJS(18133): Running "main" with {"rootTag":1,"initialProps":{},"fabric":true}
09-07 00:57:00.642 F/libc    (18133): Fatal signal 11 (SIGSEGV), code 1 (SEGV_MAPERR), fault addr 0x10 in tid 18354 (FrescoLightWeig), pid 18133 (ive.development)
F/DEBUG: Build fingerprint: 'google/sdk_gphone16k_x86_64/emu64xa16k:15/AE3A.240806.041/12890756:user/dev-keys'
F/DEBUG: Page size: 16384 bytes
F/DEBUG: pid: 18133, tid: 18354, name: FrescoLightWeig  >>> com.myhbcfo.hive.development <<<
F/DEBUG: signal 11 (SIGSEGV), code 1 (SEGV_MAPERR), fault addr 0x0000000000000010
F/DEBUG: Cause: null pointer dereference
F/DEBUG: 145 total frames
F/DEBUG: backtrace:
F/DEBUG:   #00 pc 00000000006e8007  /apex/com.android.art/lib64/libart.so (bool art::interpreter::DoCall<false>(...)+183)
F/DEBUG:   #01 pc 0000000000233101  /apex/com.android.art/lib64/libart.so (void art::interpreter::ExecuteSwitchImplCpp<false>(...)+14913)
   ... (interpreter frames repeat; the only named Java frames are kotlin.SynchronizedLazyImpl.getValue, java.util.concurrent.ThreadPoolExecutor.runWorker, ThreadPoolExecutor$Worker.run, java.lang.Thread.run)
```
The thread name is Fresco's lightweight background executor (image pipeline). The same clear-state launch succeeded in this session at 01 sign-in, 10 accessibility-smoke, 11 clipboard-scrub, 12 sign-in, 14 sign-in and in all three runners, so this is a single occurrence in 9 clear-state launches; whether it is an emulator/ART fault or an app-side image-decode fault is not established by this lane. Metro `/status` measured 0.0442058 s immediately afterwards (PID 21012 still listening), so it was not a Metro stall. Per the sweep rules the flow was not retried.
Last 40 lines:
```
Running on Pixel_8
 > Flow Reinstall purges stale secure data before auth starts
Launch app "com.myhbcfo.hive.development" with clear state... COMPLETED
Assert that id: sign-in-email is visible... FAILED

Assertion is false: id: sign-in-email is visible

Assertion 'id: sign-in-email is visible' failed. Check the UI hierarchy in debug artifacts to verify the element state and properties.

Possible causes:
- Element selector may be incorrect - check if there are similar elements with slightly different names/properties.
- Element may be temporarily unavailable due to loading state
- This could be a real regression that needs to be addressed

==== Debug output (logs & screenshots) ====

C:\Users\kodyr\.maestro\tests\2026-09-07_005651
```

### 10 accessibility-smoke — log hive-sweep5-10-accessibility-smoke.log — exit code 0 — PASS
Final step line: `Assert that id: sign-in-submit is visible... COMPLETED`
Last 30 lines:
```
Running on Pixel_8
 > Flow Accessibility smoke � labels present on the auth path
Launch app "com.myhbcfo.hive.development" with clear state... COMPLETED
Assert that id: sign-in-email is visible... COMPLETED
Assert that "HIVE" is visible... COMPLETED
Assert that "Email" is visible... COMPLETED
Tap on id: sign-in-email... COMPLETED
Input text client.owner@example.invalid... COMPLETED
Assert that id: sign-in-submit is visible... COMPLETED
```

### 11 clipboard-scrub — log hive-sweep5-11-clipboard-scrub.log — exit code 0 — PASS
Final step line: `Copy text from element with "HIVE"... COMPLETED`
Last 30 lines:
```
Running on Pixel_8
 > Flow Overwrite the device clipboard with harmless text
Launch app "com.myhbcfo.hive.development" with clear state... COMPLETED
Assert that id: sign-in-email is visible... COMPLETED
Copy text from element with "HIVE"... COMPLETED
```

### 12 sign-in — log hive-sweep5-12-sign-in.log — exit code 0 — PASS
Final step line: `Assert that id: dashboard-workspace is visible... COMPLETED`
Last 30 lines:
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

### 13 quarantine-recovery — log hive-sweep5-13-quarantine-recovery.log — exit code 0 — PASS
Final step line: `Assert that "Email" is visible... COMPLETED`
Last 30 lines:
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

### 14 sign-in — log hive-sweep5-14-sign-in.log — exit code 0 — PASS
Final step line: `Assert that id: dashboard-workspace is visible... COMPLETED`
Last 30 lines:
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

### 15 expired-session — log hive-sweep5-15-expired-session.log — exit code 0 — PASS
Final step line: `Assert that "Email" is visible... COMPLETED`
Last 30 lines:
```
Running on Pixel_8
 > Flow Expired/revoked session fails closed into a fresh sign-in
Launch app "com.myhbcfo.hive.development"... COMPLETED
Assert that "Choose a workspace" is visible... COMPLETED
Tap on "Harbor Light Bakery LLC \(Synthetic\), Client access"... COMPLETED
Assert that id: dashboard-workspace is visible... COMPLETED
Open hivedev:///?qa=expire-session... COMPLETED
Assert that id: qa-expired-ack is visible... COMPLETED
Stop com.myhbcfo.hive.development... COMPLETED
Launch app "com.myhbcfo.hive.development"... COMPLETED
Assert that id: dashboard-workspace is not visible... COMPLETED
Assert that id: signed-out-reason is visible... COMPLETED
Assert that "Note: Your session ended\. Sign in again to continue\." is visible... COMPLETED
Assert that "Email" is visible... COMPLETED
```

## STEP 4 — Tidiness (read-only, after flow 15)

```
> adb shell cmd connectivity airplane-mode
disabled
> Get-ChildItem $env:TEMP -Directory -Filter 'hive-maestro-*'
(nothing)
> Get-NetTCPConnection -LocalPort 8477,8478 -State Listen -ErrorAction SilentlyContinue
(nothing)
> adb shell settings get system font_scale
1.0
> adb shell cmd uimode night
Night mode: no
> Get-NetTCPConnection -LocalPort 8081 -State Listen | Select-Object -First 1 OwningProcess
OwningProcess 21012
> adb devices
emulator-5554	device
```
Metro and the emulator were left running. Maestro's own debug artifacts for the reinstall failure remain at `C:\Users\kodyr\.maestro\tests\2026-09-07_005651` (screenshot of the launcher, hierarchy, logcat; no secret-bearing screen was on display) — not deleted.

## Verdicts — all 18 flows in .maestro/ (from the logs above, nothing inferred)

| Flow | Verdict | Evidence |
|---|---|---|
| accessibility-smoke | PASS | sweep 10, exit 0, all steps COMPLETED (find 45 fix effective: launched from cleared state) |
| activity-and-help | PASS | sweep 03, exit 0 |
| clipboard-scrub | PASS | sweep 11, exit 0 (also ran as the enroll and confinement runners' cleanup step, COMPLETED both times) |
| confinement-probe | PASS | maestro:confinement exit 0, `CONFINEMENT PROOF OK` |
| expired-session | PASS | sweep 15, exit 0 |
| mfa-enroll | FAIL | maestro:enroll exit 1: `Tap on id: mfa-code-label... FAILED` (Element not found) after the wrong-code entry |
| mfa-login | NOT RUN | the enroll runner stopped at mfa-enroll.yaml before reaching it |
| nav-persistence | PASS | sweep 04, exit 0 |
| offline | PASS | sweep 07, exit 0 |
| quarantine-recovery | PASS | sweep 13, exit 0 |
| read-surfaces-denied | PASS | maestro:denied exit 0, `maestro:denied OK` |
| read-surfaces-offline | PASS | sweep 05, exit 0 |
| reinstall | FAIL | sweep 09, exit 1: first assertion `sign-in-email is visible` FAILED; native SIGSEGV in the app process (FrescoLightWeig thread) per logcat |
| requests | PASS | sweep 02, exit 0 |
| scope-switch | PASS | sweep 06, exit 0 |
| sign-in | PASS | sweep 01, 12, 14 and the denied runner, exit 0 each time |
| sign-out | PASS | sweep 08, exit 0 |
| staff-sign-out | NOT RUN | the enroll runner stopped at mfa-enroll.yaml before reaching it |

Totals: 14 PASS, 2 FAIL (mfa-enroll, reinstall), 2 NOT RUN (mfa-login, staff-sign-out — dependency on the enroll runner).

## Notes for the coordinator (read-only observations, not fixes)

- **mfa-enroll / `mfa-code-label`.** The testID is still wired: `src/auth/views/MfaView.tsx:129` passes `labelTestID="mfa-code-label"` to `TextField`, which renders it on the label `AppText` (`src/ui/primitives/TextField.tsx:78`), and `AppText` spreads `...rest` (including `testID`) onto the RN `Text`. The lane at ca96181 (lanes-report-3) passed this exact tap. Between then and now, slice 3 (3898ea5) changed MfaView's layout (title variant heading, larger gaps, filled setup-key panel). A plausible cause is the label being pushed off-screen under the soft keyboard after the wrong code is typed, so UiAutomator does not expose it; not verified here (the runner scrubs its own artifacts by design). Candidate finding for the branch: find 46 or next.
- **reinstall / native crash.** Single occurrence, see sweep 09 above. Worth a re-run of `reinstall.yaml` alone on the next desktop lane before treating it as an app defect; if it recurs, the Fresco thread and the 16 KB-page emulator image (emu64xa16k) are the leads.
