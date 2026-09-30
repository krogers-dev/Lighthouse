# Enrollment runner and three cleared launches at find 47 — 2026-09-07, desktop session 2 (report 6)

Head at run time: `e92c133 Find 47: the MFA flows scroll the verify control into view instead of blurring by the label; run 5 recorded (14 of 18 at bd2be6c), find 48 open`
Device: emulator-5554 (Pixel_8, API 35, 16 KB-page image), com.myhbcfo.hive.development (the clean-prebuild binary; not rebuilt here). Metro PID 21012 (`expo start --port 8081`, CI=1, EXPO_PUBLIC_QA_HOOKS=1), not restarted.
Local stack: Mailpit 127.0.0.1:54324 /api/v1/info → 200.
Nothing was retried. No process was restarted, nothing rebuilt, no `pm clear`.

## STEP 1 — state check and pull

- `git fetch origin claude/hive-fable-5-greenfield-p0cwkq` → `3b6573c..e92c133` (exit 0); `git status` → behind by 1, working tree clean; `git pull --ff-only` → fast-forward `3b6573c..e92c133`, 6 files changed (exit 0); `git log --oneline -1` → `e92c133 Find 47: the MFA flows scroll the verify control into view instead of blurring by the label; run 5 recorded (14 of 18 at bd2be6c), find 48 open`.
- `Select-String .maestro\mfa-enroll.yaml -Pattern "mfa-code-label"` → 0 matches (as required). `-Pattern "scrollUntilVisible"` → 2 matches (lines 88 and 116).
- `adb devices` → `emulator-5554 device`; `sys.boot_completed` → 1; package list → `package:com.myhbcfo.hive.development`; airplane-mode → disabled; `font_scale` → 1.0; `uimode night` → `Night mode: no`.
- Metro: listener on 8081 → OwningProcess 21012; `/status` → 0.0443 s. Mailpit `/api/v1/info` → 200.
- `hive-maestro-*` directories in TEMP → 0. Listeners on 8477/8478 → 0.

## STEP 2 — enrollment runner (mfa-enroll, staff-sign-out, mfa-login, clipboard-scrub)

`adb logcat -c` → exit 0 (buffers cleared before the run).

Command: `cmd /c "npm run maestro:enroll 2>&1" | Tee-Object -FilePath "$env:TEMP\hive-enroll6.log"`
`$LASTEXITCODE` = **1**. Final runner line: `maestro:enroll FAILED — mfa-enroll.yaml exited 1` (no `maestro:enroll OK`).

Failing step (the new find-47 step itself, the FIRST of its two occurrences, right after the wrong TOTP code was typed):
`Scrolling DOWN until id: mfa-submit is visible with speed 40, visibility percentage 100%, timeout 20000 ms, with centering disabled... FAILED` — `No visible element found: id: mfa-submit`.
Steps before it all COMPLETED, including `Copy text from element with id: mfa-enroll-secret`, `Run totp-capture.js`, `Tap on id: mfa-code`, `Input text ${output.totpWrongCode}`. So the flow got exactly one step further than at bd2be6c (where `Tap on id: mfa-code-label` failed at the same point in the flow): with the keyboard open on the enrollment screen, neither the label above the code field (bd2be6c) nor the verify control below it (this run) is found by Maestro, while the code field itself is tappable and accepts text. The runner's own cleanup ran to completion: totp-helper terminated, clipboard overwritten (the clipboard-scrub flow COMPLETED), factor revoked (1 deleted, readback zero), artifact tree scrubbed. Because the runner scrubs its artifact tree on exit, Maestro's failure screenshot and hierarchy dump for this step (`hive-maestro-enroll-8srsCi\artifacts\2026-09-07_011221`) no longer exist; `~/.maestro/tests` holds no folder for this run either. There is therefore no on-device view of what the screen looked like at the failing step.

Read-only observations from the source at e92c133 (no reproduction was attempted; the task said do not retry):
- `app/mfa.tsx` hosts `MfaView` inside `<Screen>` with the default `scroll = true`, so the content is in a `ScrollView` (`keyboardShouldPersistTaps="handled"`).
- `MfaView` renders `TextField testID="mfa-code"` immediately followed by `Button testID="mfa-submit"` (`Pressable`, `testID` forwarded, `disabled` only while the trimmed code is empty, so it is enabled once the wrong code has been typed).
- `app.json` sets no `softwareKeyboardLayoutMode`, so the Expo default applies.
- `mfa-login.yaml` carries the same `scrollUntilVisible` step; it was not reached (the runner stops at the first failing flow), so its status at find 47 is unknown, as is staff-sign-out's.

Last 40 lines of `hive-enroll6.log` (57 lines total; the runner's own lines are quoted verbatim, no secret is printed by them):
```
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
Scrolling DOWN until id: mfa-submit is visible with speed 40, visibility percentage 100%, timeout 20000 ms, with centering disabled... FAILED

No visible element found: id: mfa-submit

Could not find a visible element matching selector: id: mfa-submit
Tip: Try adjusting the following settings to improve detection:
- `timeout`: current = 20000ms ? Increase if you need more time to find the element
- `speed`: current = 40 (0-100 scale) ? Increase for faster scrolling if element is far away
- `waitToSettleTimeoutMs`: current = Not defined ? Set this value (e.g., 500ms) if your UI updates frequently between scrolls
- `visibilityPercentage`: current = 100% ? Lower this value if you want to detect partially visible elements
- `centerElement`: current = false ? Enable if you want the element to be centered after finding it


==== Debug output (logs & screenshots) ====

C:\Users\kodyr\AppData\Local\Temp\hive-maestro-enroll-8srsCi\artifacts\2026-09-07_011221
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
maestro:enroll: artifact tree scrubbed (C:\Users\kodyr\AppData\Local\Temp\hive-maestro-enroll-8srsCi removed and verified gone)
```

Crash buffer after the runner: `cmd /c "adb logcat -d -b crash > %TEMP%\hive-enroll6-crash.log"` → exit 0; the file has 0 lines; `Fatal signal` present: **no**.
Post-checks: airplane-mode → disabled; `hive-maestro-*` directories → 0; listeners on 8477/8478 → 0.

## STEP 3 — three cleared launches through reinstall.yaml

Each launch: `adb logcat -c` (exit 0) → `cmd /c "maestro test .maestro/reinstall.yaml 2>&1" | Tee-Object -FilePath "$env:TEMP\hive-reinstall-N.log"` → `cmd /c "adb logcat -d -b crash > %TEMP%\hive-reinstall-N-crash.log"` → airplane-mode check.

### Launch 1 — `$LASTEXITCODE` = **0**; final line `Assert that "Enter your sign-in code" is visible... COMPLETED`; crash buffer: 0 lines, `Fatal signal`/`SIGSEGV` present: **no**; airplane-mode after: disabled.
Last 30 lines (the log has 10):
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

### Launch 2 — `$LASTEXITCODE` = **0**; final line `Assert that "Enter your sign-in code" is visible... COMPLETED`; crash buffer: 0 lines, `Fatal signal`/`SIGSEGV` present: **no**; airplane-mode after: disabled.
Last 30 lines (the log has 10):
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

### Launch 3 — `$LASTEXITCODE` = **0**; final line `Assert that "Enter your sign-in code" is visible... COMPLETED`; crash buffer: 0 lines, `Fatal signal`/`SIGSEGV` present: **no**; airplane-mode after: disabled.
Last 30 lines (the log has 10):
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

Every step in all three launches reported COMPLETED; no crash buffer entry was produced by any of them. Find 48 (the one SIGSEGV in `FrescoLightWeig` at bd2be6c) did not reproduce in 3 of 3 cleared launches at e92c133; with the earlier runs that makes 1 native crash in 12 cleared launches across the two sessions, none at this head.

## STEP 4 — tidiness (read-only)

- `hive-maestro-*` directories in TEMP → 0. Listeners on 8477/8478 → 0.
- airplane-mode → disabled; `font_scale` → 1.0; `uimode night` → `Night mode: no`.
- Metro still listening on 8081, OwningProcess 21012; `/status` → 0.0454 s. `adb devices` → `emulator-5554 device`.
- Metro and the emulator were left running.

## Verdicts

| Flow | Verdict |
|---|---|
| mfa-enroll | **FAIL** — `scrollUntilVisible id: mfa-submit` timed out (20 s) after the wrong code was typed; runner exit 1 |
| staff-sign-out | **NOT RUN** — the runner stopped at mfa-enroll |
| mfa-login | **NOT RUN** — the runner stopped at mfa-enroll |
| clipboard-scrub | **FAIL by rule** — the flow's steps COMPLETED as the runner's exit cleanup, but the runner did not print `maestro:enroll OK` |
| reinstall ×1 | **PASS** — exit 0, every step COMPLETED, crash: no |
| reinstall ×2 | **PASS** — exit 0, every step COMPLETED, crash: no |
| reinstall ×3 | **PASS** — exit 0, every step COMPLETED, crash: no |

Suggested next step for the branch owner (not done here): have the enrollment runner preserve Maestro's failure artifacts (screenshot and view hierarchy) on a non-zero exit before scrubbing, or copy them to a redacted location, so the next desktop run can show what the enrollment screen looks like under the open keyboard; the two consecutive failures (label above the field at bd2be6c, control below it at e92c133) both occurred at the same moment of the flow with the code field focused.
