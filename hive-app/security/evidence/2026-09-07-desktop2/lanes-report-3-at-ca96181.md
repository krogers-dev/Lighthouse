# HIVE device-lane report 3 — head ca96181 (2026-09-06, Kody's Windows desktop, emulator-5554 Pixel_8)

Operator: local desktop session `hive-app-08`, driven by the cloud coordinator's task. Synthetic data only. No repository edits, no commits, no `pm clear`, no Metro/emulator restarts. Runner OK/FAIL lines, Maestro step lines, and error/stack lines only.

## Git head

```
git fetch origin claude/hive-fable-5-greenfield-p0cwkq
   1371b66..ca96181  claude/hive-fable-5-greenfield-p0cwkq -> origin/claude/hive-fable-5-greenfield-p0cwkq
git status
On branch claude/hive-fable-5-greenfield-p0cwkq
Your branch is behind 'origin/claude/hive-fable-5-greenfield-p0cwkq' by 2 commits, and can be fast-forwarded.
nothing to commit, working tree clean
git log --oneline -1   (before pull)
1371b66 Ratification follow-up: tests exercise the live substance as proposed; gate wording says FAIL (exit 1) without the record
git pull --ff-only
Updating 1371b66..ca96181  Fast-forward  45 files changed, 493 insertions(+), 87 deletions(-)
git log --oneline -1   (after pull)
ca96181 Client-facing wording: the review's decisions applied; support address as public config; honest sign-in answers
```

Head after pull: **ca96181** (expected). Working tree clean.

## STEP 1 — State check (verbatim)

```
adb devices
List of devices attached
emulator-5554	device

adb shell getprop sys.boot_completed
1
adb shell cmd package list packages com.myhbcfo
package:com.myhbcfo.hive.development
adb shell cmd connectivity airplane-mode
disabled
Get-NetTCPConnection -LocalPort 8081 -State Listen | Select-Object -First 1 OwningProcess
OwningProcess
-------------
        40480
(Invoke-WebRequest -UseBasicParsing http://127.0.0.1:54324/api/v1/info).StatusCode
200
Get-ChildItem $env:TEMP -Directory -Filter 'hive-maestro-*'
(nothing)
Get-NetTCPConnection -LocalPort 8477,8478 -State Listen
(nothing)
```

All STEP 1 checks healthy. Nothing found to report.

## STEP 2 — The three runners

### Runner 1: maestro:enroll — PASS

Command: `cmd /c "npm run maestro:enroll 2>&1" | Tee-Object -FilePath "$env:TEMP\hive-enroll4.log"`
`$LASTEXITCODE` = **0**
Final OK line: `maestro:enroll OK — reset -> enroll -> sign-out -> login on the SAME factor -> revoke completed sequentially; helper terminated, clipboard scrubbed, artifacts confined and removed`

Log tail (30):
```
 > Flow Subsequent staff login verifies against the existing factor (no second QR)
Launch app "com.myhbcfo.hive.development"... COMPLETED
Tap on id: sign-in-email... COMPLETED
Input text reviewer.rae@example.invalid... COMPLETED
Run otp-snapshot.js... COMPLETED
Tap on id: sign-in-submit... COMPLETED
Assert that "Enter your sign-in code" is visible... COMPLETED
Run otp-fetch.js... COMPLETED
Tap on id: otp-code... COMPLETED
Input text ${output.otpCode}... COMPLETED
Tap on id: otp-submit... COMPLETED
Assert that id: mfa-enroll-qr is not visible... COMPLETED
Assert that id: mfa-code is visible... COMPLETED
Run totp-code.js... COMPLETED
Tap on id: mfa-code... COMPLETED
Input text ${output.totpCode}... COMPLETED
Tap on id: mfa-code-label... COMPLETED
Tap on id: mfa-submit... COMPLETED
Assert that id: dashboard-workspace is visible... COMPLETED
reset-totp: reviewer.rae@example.invalid is factor-clean (1 deleted, readback verified zero)
maestro:enroll: factor revoked and verified clean (post-run revocation)
maestro:enroll: totp-helper terminated (in-memory secret discarded)
Running on Pixel_8
 > Flow Overwrite the device clipboard with harmless text
Launch app "com.myhbcfo.hive.development" with clear state... COMPLETED
Assert that id: sign-in-email is visible... COMPLETED
Copy text from element with "HIVE"... COMPLETED
maestro:enroll: device clipboard overwritten (success)
maestro:enroll: artifact tree scrubbed (C:\Users\kodyr\AppData\Local\Temp\hive-maestro-enroll-mcKz4a removed and verified gone)
maestro:enroll OK — reset -> enroll -> sign-out -> login on the SAME factor -> revoke completed sequentially; helper terminated, clipboard scrubbed, artifacts confined and removed
```

Post-runner: airplane-mode `disabled`; `hive-maestro-*` temp dirs: nothing; ports 8477/8478 listening: nothing.

### Runner 2: maestro:confinement — PASS

Command: `cmd /c "npm run maestro:confinement 2>&1" | Tee-Object -FilePath "$env:TEMP\hive-confinement3.log"`
`$LASTEXITCODE` = **0**
Final OK line: `maestro:enroll CONFINEMENT PROOF OK — the QR-bearing failure artifact was confined to the private run root and is now scrubbed (no such screenshot is retained)`
(The FAILED assertion inside the tail is the probe's designed failure; the proof is that its artifact stayed inside the private run root and was scrubbed.)

Log tail (30):
```
Tap on id: otp-submit... COMPLETED
Assert that "Set up your authenticator" is visible... COMPLETED
Assert that id: mfa-enroll-qr is visible... COMPLETED
Assert that id: mfa-enroll-secret is visible... COMPLETED
Assert that "HIVE CONFINEMENT PROBE — no screen contains this text" is visible... FAILED

Assertion is false: "HIVE CONFINEMENT PROBE — no screen contains this text" is visible

Assertion '"HIVE CONFINEMENT PROBE — no screen contains this text" is visible' failed. Check the UI hierarchy in debug artifacts to verify the element state and properties.

Possible causes:
- Element selector may be incorrect - check if there are similar elements with slightly different names/properties.
- Element may be temporarily unavailable due to loading state
- This could be a real regression that needs to be addressed

==== Debug output (logs & screenshots) ====

C:\Users\kodyr\AppData\Local\Temp\hive-maestro-enroll-awXU61\artifacts\2026-09-06_215140
maestro:enroll: confinement proof — 7 artifact(s) captured, 1 screenshot(s), ALL inside C:\Users\kodyr\AppData\Local\Temp\hive-maestro-enroll-awXU61; none in C:\Users\kodyr\.maestro\tests
maestro:enroll: totp-helper terminated (in-memory secret discarded)
Running on Pixel_8
 > Flow Overwrite the device clipboard with harmless text
Launch app "com.myhbcfo.hive.development" with clear state... COMPLETED
Assert that id: sign-in-email is visible... COMPLETED
Copy text from element with "HIVE"... COMPLETED
maestro:enroll: device clipboard overwritten (confinement proof)
reset-totp: reviewer.rae@example.invalid is factor-clean (1 deleted, readback verified zero)
maestro:enroll: factor revoked and verified clean (confinement proof)
maestro:enroll: artifact tree scrubbed (C:\Users\kodyr\AppData\Local\Temp\hive-maestro-enroll-awXU61 removed and verified gone)
maestro:enroll CONFINEMENT PROOF OK — the QR-bearing failure artifact was confined to the private run root and is now scrubbed (no such screenshot is retained)
```

Post-runner: airplane-mode `disabled`; `hive-maestro-*` temp dirs: nothing; ports 8477/8478 listening: nothing.

### Runner 3: maestro:denied — FAIL

Command: `cmd /c "npm run maestro:denied 2>&1" | Tee-Object -FilePath "$env:TEMP\hive-denied3.log"`
`$LASTEXITCODE` = **1**
FAIL line: `maestro:denied FAILED — read-surfaces-denied.yaml exited 1`
Failed step: read-surfaces-denied.yaml, second step, `Assert that "Choose a workspace" is visible... FAILED` (the first assertion after `launchApp` with `clearState: false`, immediately after sign-in.yaml had reached `dashboard-workspace`). No revoke was reached (the revoke runScript is later in the flow); the runner's exit path restored and verified the membership and scrubbed the artifact tree.
Not retried (rules). Note: in the sweep, flows 02–08, 13 and 15 all launched the app the same way straight after a sign-in and their `Assert that "Choose a workspace" is visible` step COMPLETED every time, so this failure did not reproduce in the sweep. The scrubbed artifacts were not inspected.

Log tail (40):
```
maestro:denied: running sign-in.yaml (sequential; artifacts confined to C:\Users\kodyr\AppData\Local\Temp\hive-maestro-denied-3voc1d; watchdog 600000ms)
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
maestro:denied: running read-surfaces-denied.yaml (sequential; artifacts confined to C:\Users\kodyr\AppData\Local\Temp\hive-maestro-denied-3voc1d; watchdog 600000ms)
Running on Pixel_8
 > Flow Revoked membership denies the read surfaces without showing stale rows
Launch app "com.myhbcfo.hive.development"... COMPLETED
Assert that "Choose a workspace" is visible... FAILED

Assertion is false: "Choose a workspace" is visible

Assertion '"Choose a workspace" is visible' failed. Check the UI hierarchy in debug artifacts to verify the element state and properties.

Possible causes:
- Element selector may be incorrect - check if there are similar elements with slightly different names/properties.
- Element may be temporarily unavailable due to loading state
- This could be a real regression that needs to be addressed

==== Debug output (logs & screenshots) ====

C:\Users\kodyr\AppData\Local\Temp\hive-maestro-denied-3voc1d\artifacts\2026-09-06_215338
maestro:denied FAILED — read-surfaces-denied.yaml exited 1
membership-restore: client.owner@example.invalid on entityA1 restored (1 seeded row(s) present, readback verified)
maestro:denied: membership restored and verified (process exit)
maestro:denied: artifact tree scrubbed (C:\Users\kodyr\AppData\Local\Temp\hive-maestro-denied-3voc1d removed and verified gone)
```

Post-runner: airplane-mode `disabled`; `hive-maestro-*` temp dirs: nothing; ports 8477/8478 listening: nothing.

## STEP 3 — The fifteen sweep runs (twelve flows)

Every run below was followed by `adb shell cmd connectivity airplane-mode`; it printed `disabled` after every one of the fifteen runs, so no manual disable was needed.

### 01 sign-in — PASS
Command: `cmd /c "maestro test .maestro/sign-in.yaml 2>&1" | Tee-Object -FilePath "$env:TEMP\hive-sweep4-01-sign-in.log"`
`$LASTEXITCODE` = **0**. Final line: `Assert that id: dashboard-workspace is visible... COMPLETED`
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

### 02 requests — PASS
Command: `cmd /c "maestro test .maestro/requests.yaml 2>&1" | Tee-Object -FilePath "$env:TEMP\hive-sweep4-02-requests.log"`
`$LASTEXITCODE` = **0**. Final line: `Assert that id: requests-list is visible... COMPLETED`
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
Tap on id: request-detail-back... COMPLETED
Assert that id: requests-list is visible... COMPLETED
```

### 03 activity-and-help — PASS
Command: `cmd /c "maestro test .maestro/activity-and-help.yaml 2>&1" | Tee-Object -FilePath "$env:TEMP\hive-sweep4-03-activity-and-help.log"`
`$LASTEXITCODE` = **0**. Final line: `Disable airplane mode... COMPLETED`
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

### 04 nav-persistence — PASS
Command: `cmd /c "maestro test .maestro/nav-persistence.yaml 2>&1" | Tee-Object -FilePath "$env:TEMP\hive-sweep4-04-nav-persistence.log"`
`$LASTEXITCODE` = **0**. Final line: `Assert that id: nav-account is visible... COMPLETED`
```
Running on Pixel_8
 > Flow The five destinations are peers — the nav survives arriving at each one
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
Tap on id: settings-back... COMPLETED
Assert that id: help-screen is visible... COMPLETED
Assert that id: nav-account is visible... COMPLETED
```

### 05 read-surfaces-offline — PASS
Command: `cmd /c "maestro test .maestro/read-surfaces-offline.yaml 2>&1" | Tee-Object -FilePath "$env:TEMP\hive-sweep4-05-read-surfaces-offline.log"`
`$LASTEXITCODE` = **0**. Final line: `Assert that "Bank statement for the closing month \(Synthetic\)" is visible... COMPLETED`
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

### 06 scope-switch — PASS
Command: `cmd /c "maestro test .maestro/scope-switch.yaml 2>&1" | Tee-Object -FilePath "$env:TEMP\hive-sweep4-06-scope-switch.log"`
`$LASTEXITCODE` = **0**. Final line: `Assert that "2025 books close \(Synthetic\)" is not visible... COMPLETED`
```
Running on Pixel_8
 > Flow Entity switch clears content and rebinds the dashboard
Launch app "com.myhbcfo.hive.development"... COMPLETED
Assert that "Choose a workspace" is visible... COMPLETED
Tap on "Harbor Light Bakery LLC \(Synthetic\), Client access"... COMPLETED
Assert that id: dashboard-workspace is visible... COMPLETED
Tap on id: nav-account... COMPLETED
Assert that id: settings-screen is visible... COMPLETED
Tap on id: settings-switch-scope... COMPLETED
Assert that "Choose a workspace" is visible... COMPLETED
Assert that "2025 books close \(Synthetic\)" is not visible... COMPLETED
Tap on "Harbor Light Bakery LLC \(Synthetic\), Harbor Light Holdings LLC \(Synthetic\), Client access"... COMPLETED
Assert that id: dashboard-workspace is visible... COMPLETED
Assert that "Nothing needs your attention" is visible... COMPLETED
Assert that "2025 books close \(Synthetic\)" is not visible... COMPLETED
```

### 07 offline — PASS
Command: `cmd /c "maestro test .maestro/offline.yaml 2>&1" | Tee-Object -FilePath "$env:TEMP\hive-sweep4-07-offline.log"`
`$LASTEXITCODE` = **0**. Final line: `Assert that id: dashboard-workspace is visible... COMPLETED`
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
Tap on id: settings-switch-scope... COMPLETED
Assert that "Choose a workspace" is visible... COMPLETED
Tap on "Harbor Light Bakery LLC \(Synthetic\), Client access"... COMPLETED
Assert that "You are offline" is visible... COMPLETED
Disable airplane mode... COMPLETED
Tap on "Check connection"... COMPLETED
Assert that id: dashboard-workspace is visible... COMPLETED
```

### 08 sign-out — PASS
Command: `cmd /c "maestro test .maestro/sign-out.yaml 2>&1" | Tee-Object -FilePath "$env:TEMP\hive-sweep4-08-sign-out.log"`
`$LASTEXITCODE` = **0**. Final line: `Assert that id: dashboard-workspace is not visible... COMPLETED`
```
Running on Pixel_8
 > Flow Sign-out removes protected UI and survives relaunch signed out
Launch app "com.myhbcfo.hive.development"... COMPLETED
Assert that "Choose a workspace" is visible... COMPLETED
Tap on "Harbor Light Bakery LLC \(Synthetic\), Client access"... COMPLETED
Assert that id: dashboard-workspace is visible... COMPLETED
Tap on id: nav-account... COMPLETED
Assert that id: settings-screen is visible... COMPLETED
Tap on id: settings-sign-out... COMPLETED
Assert that id: sign-in-email is visible... COMPLETED
Stop com.myhbcfo.hive.development... COMPLETED
Launch app "com.myhbcfo.hive.development"... COMPLETED
Assert that id: sign-in-email is visible... COMPLETED
Assert that id: dashboard-workspace is not visible... COMPLETED
```

### 09 reinstall — PASS
Command: `cmd /c "maestro test .maestro/reinstall.yaml 2>&1" | Tee-Object -FilePath "$env:TEMP\hive-sweep4-09-reinstall.log"`
`$LASTEXITCODE` = **0**. Final line: `Assert that "Enter your sign-in code" is visible... COMPLETED`
```
Running on Pixel_8
 > Flow Reinstall purges stale secure data before auth starts
Launch app "com.myhbcfo.hive.development" with clear state... COMPLETED
Assert that id: sign-in-email is visible... COMPLETED
Assert that id: dashboard-workspace is not visible... COMPLETED
Assert that id: quarantine-screen is not visible... COMPLETED
Assert that id: sign-in-email is visible... COMPLETED
Tap on id: sign-in-email... COMPLETED
Input text client.owner@example.invalid... COMPLETED
Tap on id: sign-in-submit... COMPLETED
Assert that "Enter your sign-in code" is visible... COMPLETED
```

### 10 accessibility-smoke — FAIL (Maestro driver start-up timeout; no flow step executed)
Command: `cmd /c "maestro test .maestro/accessibility-smoke.yaml 2>&1" | Tee-Object -FilePath "$env:TEMP\hive-sweep4-10-accessibility-smoke.log"`
`$LASTEXITCODE` = **1**. Final line: `	at kotlinx.coroutines.scheduling.CoroutineScheduler$Worker.run(CoroutineScheduler.kt:704)`
Failed step: none reached. The failure is the Maestro Android driver failing to start (`AndroidDriverTimeoutException`, driver port 57077), before "Running on Pixel_8" or any flow step. Not retried (rules). Immediately afterwards `adb devices` showed `emulator-5554 device` and `sys.boot_completed` = 1, and flow 11 started the driver and passed, so the timeout was transient on this run. The flow's assertions were therefore NOT exercised at ca96181 in this sweep.

Log tail (40; the whole log):
```

Maestro Android driver did not start up in time on emulator [ emulator-5554 ] (driver port 57077)

The stack trace was:
maestro.MaestroDriverStartupException$AndroidDriverTimeoutException: Maestro Android driver did not start up in time on emulator [ emulator-5554 ] (driver port 57077)
	at maestro.drivers.AndroidDriver.awaitLaunch(AndroidDriver.kt:164)
	at maestro.drivers.AndroidDriver.open(AndroidDriver.kt:114)
	at maestro.Maestro$Companion.android(Maestro.kt:800)
	at maestro.cli.session.MaestroSessionManager.createAndroid(MaestroSessionManager.kt:347)
	at maestro.cli.session.MaestroSessionManager.createMaestro(MaestroSessionManager.kt:210)
	at maestro.cli.session.MaestroSessionManager.newSession(MaestroSessionManager.kt:108)
	at maestro.cli.session.MaestroSessionManager.newSession$default(MaestroSessionManager.kt:66)
	at maestro.cli.command.TestCommand.runShardSuite(TestCommand.kt:477)
	at maestro.cli.command.TestCommand.access$runShardSuite(TestCommand.kt:81)
	at maestro.cli.command.TestCommand$handleSessions$1$results$1$1.invokeSuspend(TestCommand.kt:438)
	at kotlin.coroutines.jvm.internal.BaseContinuationImpl.resumeWith(ContinuationImpl.kt:34)
	at kotlinx.coroutines.DispatchedTask.run(DispatchedTask.kt:100)
	at kotlinx.coroutines.internal.LimitedDispatcher$Worker.run(LimitedDispatcher.kt:124)
	at kotlinx.coroutines.scheduling.TaskImpl.run(Tasks.kt:89)
	at kotlinx.coroutines.scheduling.CoroutineScheduler.runSafely(CoroutineScheduler.kt:586)
	at kotlinx.coroutines.scheduling.CoroutineScheduler$Worker.executeTask(CoroutineScheduler.kt:820)
	at kotlinx.coroutines.scheduling.CoroutineScheduler$Worker.runWorker(CoroutineScheduler.kt:717)
	at kotlinx.coroutines.scheduling.CoroutineScheduler$Worker.run(CoroutineScheduler.kt:704)

```

### 11 clipboard-scrub — PASS
Command: `cmd /c "maestro test .maestro/clipboard-scrub.yaml 2>&1" | Tee-Object -FilePath "$env:TEMP\hive-sweep4-11-clipboard-scrub.log"`
`$LASTEXITCODE` = **0**. Final line: `Copy text from element with "HIVE"... COMPLETED`
```
Running on Pixel_8
 > Flow Overwrite the device clipboard with harmless text
Launch app "com.myhbcfo.hive.development" with clear state... COMPLETED
Assert that id: sign-in-email is visible... COMPLETED
Copy text from element with "HIVE"... COMPLETED
```

### 12 sign-in — PASS
Command: `cmd /c "maestro test .maestro/sign-in.yaml 2>&1" | Tee-Object -FilePath "$env:TEMP\hive-sweep4-12-sign-in.log"`
`$LASTEXITCODE` = **0**. Final line: `Assert that id: dashboard-workspace is visible... COMPLETED`
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

### 13 quarantine-recovery — FAIL
Command: `cmd /c "maestro test .maestro/quarantine-recovery.yaml 2>&1" | Tee-Object -FilePath "$env:TEMP\hive-sweep4-13-quarantine-recovery.log"`
`$LASTEXITCODE` = **1**. Final line: `C:\Users\kodyr\.maestro\tests\2026-09-06_220233`
Failed step: `Tap on "Reset secure sign-in data"... FAILED` — `Element not found: Text matching regex: Reset secure sign-in data`. Not retried (rules).
Read-only observation (source at ca96181, not a claim about intent): commit ca96181 changed the quarantine action label in `src/ui/primitives/states.tsx` from `Reset secure sign-in data` to `Reset sign-in on this device`, while `.maestro/quarantine-recovery.yaml` line 37 still taps `Reset secure sign-in data`. The preceding new-wording assertion (`Sign-in on this device needs a reset`) COMPLETED, so the quarantine screen itself rendered. The flow's tail (scrub -> signed-out -> not quarantined) was not exercised. The app was left on the quarantine screen; flow 14 launched with clear state and reached the dashboard normally.

Log tail (40; the whole log):
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
Tap on "Reset secure sign-in data"... FAILED

Element not found: Text matching regex: Reset secure sign-in data

Element with Text matching regex: Reset secure sign-in data not found. Check the UI hierarchy in debug artifacts to verify if the element exists.

Possible causes:
- Element selector may be incorrect - check if there are similar elements with slightly different names/properties.
- Element may be temporarily unavailable due to loading state.
- This could be a real regression that needs to be addressed.

==== Debug output (logs & screenshots) ====

C:\Users\kodyr\.maestro\tests\2026-09-06_220233
```

### 14 sign-in — PASS
Command: `cmd /c "maestro test .maestro/sign-in.yaml 2>&1" | Tee-Object -FilePath "$env:TEMP\hive-sweep4-14-sign-in.log"`
`$LASTEXITCODE` = **0**. Final line: `Assert that id: dashboard-workspace is visible... COMPLETED`
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

### 15 expired-session — PASS
Command: `cmd /c "maestro test .maestro/expired-session.yaml 2>&1" | Tee-Object -FilePath "$env:TEMP\hive-sweep4-15-expired-session.log"`
`$LASTEXITCODE` = **0**. Final line: `Assert that "Email" is visible... COMPLETED`
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

## STEP 4 — Tidiness (read-only)

```
Get-ChildItem $env:TEMP -Directory -Filter 'hive-maestro-*'
(nothing)
Get-NetTCPConnection -LocalPort 8477,8478 -State Listen
(nothing)
adb shell cmd connectivity airplane-mode
disabled
```

Bare `maestro test` debug folders remain under C:\Users\kodyr\.maestro\tests (synthetic content), including 2026-09-06_220233 from the flow 13 failure; left in place as instructed. Logs saved: `$env:TEMP\hive-enroll4.log`, `hive-confinement3.log`, `hive-denied3.log`, `hive-sweep4-01..15-*.log`.

## Verdicts — all 18 flows in `.maestro/` at head ca96181

| Flow | Verdict | Evidence |
|---|---|---|
| mfa-enroll | PASS | maestro:enroll runner, exit 0, `maestro:enroll OK` |
| staff-sign-out | PASS | maestro:enroll runner, exit 0, `maestro:enroll OK` |
| mfa-login | PASS | maestro:enroll runner, exit 0, `maestro:enroll OK` |
| clipboard-scrub | PASS | maestro:enroll runner (`maestro:enroll OK`) and bare sweep run 11, exit 0, all steps COMPLETED |
| confinement-probe | PASS | maestro:confinement runner, exit 0, `maestro:enroll CONFINEMENT PROOF OK` |
| sign-in | PASS | bare sweep runs 01, 12, 14 each exit 0, all steps COMPLETED (also COMPLETED inside the denied runner before its flow 2 failed) |
| read-surfaces-denied | FAIL | maestro:denied runner exit 1, `maestro:denied FAILED — read-surfaces-denied.yaml exited 1`; failed step `Assert that "Choose a workspace" is visible` (step 2, before the revoke) |
| requests | PASS | sweep 02, exit 0 |
| activity-and-help | PASS | sweep 03, exit 0 |
| nav-persistence | PASS | sweep 04, exit 0 |
| read-surfaces-offline | PASS | sweep 05, exit 0 |
| scope-switch | PASS | sweep 06, exit 0 |
| offline | PASS | sweep 07, exit 0 |
| sign-out | PASS | sweep 08, exit 0 |
| reinstall | PASS | sweep 09, exit 0 |
| accessibility-smoke | FAIL | sweep 10, exit 1, Maestro Android driver start-up timeout; no flow step executed (not retried per rules) |
| quarantine-recovery | FAIL | sweep 13, exit 1; failed step `Tap on "Reset secure sign-in data"` — element not found (app label at ca96181 is `Reset sign-in on this device`) |
| expired-session | PASS | sweep 15, exit 0 |

Totals: 15 PASS, 3 FAIL, 0 NOT RUN. Nothing inferred beyond the logs.

Delivery: cloud-session lookup via ListAgents found no peer whose name starts with `lighthouse-` (see the delivery note appended below by the operator session).

## Delivery note (operator session hive-app-08)

ListAgents was run four times (initial, then three retries each after a 60-second wait). No peer session whose name starts with `lighthouse-` was listed on any attempt. The peer list did include a cloud session named "HIVE Claude Fable 5 Greenfield Build" (ref 777c37, running) and a cloud session "Google Drive document" (ref 2c92be, idle); neither matches the instructed prefix, so no message was sent. The report was printed in the operator session's final message and this file is left in place at $env:TEMP\hive-lanes-report-3.md.
