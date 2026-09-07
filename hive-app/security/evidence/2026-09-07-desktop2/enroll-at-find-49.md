# HIVE device lane — enrollment runner and sign-in at head fc1de67, find 49 keyboard room (2026-09-07, Kody's Windows desktop, emulator-5554 Pixel_8 API 35)

Operator: local desktop session driven by the cloud coordinator's task. Synthetic data only. No `pm clear`, no rebuild/prebuild, no Metro or emulator restart, no retry of the failed lane. Runner OK/FAIL lines, Maestro step lines, adb/git output lines, and error lines only; no token, secret, TOTP key, QR, or clipboard content recorded.

**Verdict in one line: sign-in PASS (exit 0, 16/16 steps COMPLETED on the new bundle); `maestro:enroll` FAIL (exit 1) at the same step as before, `scrollUntilVisible id: mfa-submit`; the find 49 container is in the served bundle but the scroll view does not shrink when the keyboard shows, so the verify control stays under the keyboard. Crash buffer empty (no `Fatal signal`).**

## Git head

```
git fetch origin claude/hive-fable-5-greenfield-p0cwkq
   e970016..fc1de67  claude/hive-fable-5-greenfield-p0cwkq -> origin/claude/hive-fable-5-greenfield-p0cwkq
git status
On branch claude/hive-fable-5-greenfield-p0cwkq
Your branch is behind 'origin/claude/hive-fable-5-greenfield-p0cwkq' by 2 commits, and can be fast-forwarded.
nothing to commit, working tree clean
git pull --ff-only
Updating e970016..fc1de67
Fast-forward
 .../2026-08-22-milestone1-read-only-dashboard.md   |  76 +++++++++++++++
 hive-app/src/ui/__tests__/screen.test.tsx          | 106 +++++++++++++++++++++
 hive-app/src/ui/primitives/Screen.tsx              |  45 ++++++---
 3 files changed, 215 insertions(+), 12 deletions(-)
git log --oneline -1
fc1de67 Find 49: the screen shell makes room for the soft keyboard (edge-to-edge overlays it); measured on the device, fixed with a padding keyboard-avoiding container
```

Head fc1de67 is newer than b0b860c and its message begins "Find 49: the screen shell makes room for the soft keyboard". No wait loop was needed.

```
Select-String -Path src\ui\primitives\Screen.tsx -Pattern "KeyboardAvoidingView"
3: KeyboardAvoidingView,
108: <KeyboardAvoidingView
124: </KeyboardAvoidingView>
```

## STEP 1 — state check (verbatim)

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
adb shell settings get system font_scale
1.0
adb shell cmd uimode night
Night mode: no
Get-NetTCPConnection -LocalPort 8081 -State Listen | Select-Object -First 1 OwningProcess
OwningProcess : 21012
Measure-Command { Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8081/status } | TotalSeconds
0.0475162
(Invoke-WebRequest -UseBasicParsing http://127.0.0.1:54324/api/v1/info).StatusCode
200
Get-ChildItem $env:TEMP -Directory -Filter 'hive-maestro-*'
(nothing)
Get-NetTCPConnection -LocalPort 8477,8478 -State Listen
(nothing)
```

Metro answered `/status` in 0.05 s (well under the 1 s expectation). Mailpit 200. No stale artifact tree, no helper port listening.

## STEP 2 — warm the new bundle, then sign-in

```
adb shell am force-stop com.myhbcfo.hive.development
adb shell monkey -p com.myhbcfo.hive.development -c android.intent.category.LAUNCHER 1
Events injected: 1
(wait 45 s)
cmd /c "adb exec-out uiautomator dump /dev/tty" | Select-String "sign-in-email|brand-wordmark|Choose a workspace|dashboard-workspace" | Select-Object -First 2
brand-wordmark
```

The dump matched `brand-wordmark`: the app came up on the bundle Metro served after the pull.

```
cmd /c "maestro test .maestro/sign-in.yaml 2>&1" | Tee-Object -FilePath "$env:TEMP\hive-signin-kb.log"
SIGNIN_EXIT=0
```

Last 30 lines of `hive-signin-kb.log` (the whole run; 16 steps, all COMPLETED):

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

Airplane mode after the flow: `disabled`.

## STEP 3 — enrollment runner

```
adb logcat -c
cmd /c "npm run maestro:enroll 2>&1" | Tee-Object -FilePath "$env:TEMP\hive-enroll6.log"
ENROLL_EXIT=1
final line: maestro:enroll: artifact tree scrubbed (C:\Users\kodyr\AppData\Local\Temp\hive-maestro-enroll-Pr845V removed and verified gone)
```

Failed step, exactly: `mfa-enroll.yaml` → `Scrolling DOWN until id: mfa-submit is visible with speed 40, visibility percentage 100%, timeout 20000 ms, with centering disabled... FAILED` / `No visible element found: id: mfa-submit`. Everything before it (OTP sign-in for reviewer.rae, the enrollment screen, QR and secret assertions, the secret copy, TOTP capture, the wrong-code entry) COMPLETED. Not retried.

Last 40 lines of `hive-enroll6.log`:

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

C:\Users\kodyr\AppData\Local\Temp\hive-maestro-enroll-Pr845V\artifacts\2026-09-07_013530
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
maestro:enroll: artifact tree scrubbed (C:\Users\kodyr\AppData\Local\Temp\hive-maestro-enroll-Pr845V removed and verified gone)
```

The runner's exit path did its work: totp-helper terminated, clipboard overwritten, the factor revoked and read back zero, and the artifact tree scrubbed and verified gone.

### Crash buffer (find 48 tracking)

```
cmd /c "adb logcat -d -b crash > %TEMP%\hive-enroll6-crash.log"
crash log size: 0 bytes
Fatal signal matches: 0
```

The crash buffer, cleared before the run, is empty after it: no `Fatal signal`, no native crash during this enrollment run.

### Post-checks

```
adb shell cmd connectivity airplane-mode
disabled
Get-ChildItem $env:TEMP -Directory -Filter 'hive-maestro-*'
(nothing)
Get-NetTCPConnection -LocalPort 8477,8478 -State Listen
(nothing)
```

## Read-only diagnostics (outside the numbered steps; no lane re-run, no code change)

Taken so the failure record says *why* the same step still fails, not only that it does.

**1. The served bundle carries the find 49 container.** Fetched Metro's Android dev bundle over HTTP and searched it:

```
bundle fetch seconds: 11.3169393
bundle bytes: 8036706
screen-keyboard-room matches: 1
KeyboardAvoidingView matches: 6
```

So the app did not run stale code: the `screen-keyboard-room` testID and the `KeyboardAvoidingView` are in what Metro serves.

**2. No JS warnings or errors.** `adb logcat -d -b main -s ReactNativeJS:W` after the run: 0 lines.

**3. The container does not shrink the scroll view when the keyboard shows** (sign-in screen, keyboard raised by tapping `sign-in-email`, then dismissed with one BACK; the app stayed on sign-in).

```
BEFORE  screen-keyboard-room: (absent from the uiautomator dump; consistent with a layout-only view being flattened; the padding would still apply to the layout)
BEFORE  ScrollView bounds: [0,0][1080,2400] ; [0,295][1080,2400]
BEFORE  sign-in-submit: [63,952][1017,1089]
(tap sign-in-email; wait 3 s)
dumpsys input_method: mInputShown=true  mIsInputViewShown=true
AFTER   ScrollView bounds: [0,0][1080,2400] ; [0,295][1080,2400]   <- unchanged
AFTER   sign-in-submit: [63,952][1017,1089]
InsetsSource id=3 type=ime frame=[0,1517][1080,2400] visibleFrame=[0,1517][1080,2400] visible=true
InsetsSourceControl: mType=ime mInsetsHint=Insets{left=0, top=0, right=0, bottom=883}
app window mAttrs: sim={adjust=resize forwardNavigation} layoutInDisplayCutoutMode=always ty=BASE_APPLICATION
app window Frames: frame=[0,0][1080,2400] last=[0,0][1080,2400]   <- not resized for the keyboard
InputMethod window Frames: frame=[0,74][1080,2400]
(BACK once) dumpsys input_method: mInputShown=false
```

Reading: the keyboard covers y 1517 to 2400 (883 px) and the app window is declared adjust=resize but keeps its full 2400 px frame (edge-to-edge, as find 49 describes). With the keyboard up, the screen's ScrollView still spans [0,295][1080,2400]; if the padding container had measured an 883 px overlap and padded by it, the ScrollView's bottom would have risen to about y 1517. It did not, so on this device the container's measured overlap is zero, which matches the enrollment screen's verify control still being unreachable at maximum scroll. Whether the root view's keyboard event reports a zero height under edge-to-edge on RN 0.86, or the container measures before the keyboard frame arrives, is for the cloud session to determine in code; this record shows only that the padding did not take effect.

## Verdict per flow

| Flow | Result | Evidence |
|---|---|---|
| sign-in | PASS | `maestro test .maestro/sign-in.yaml` exit 0, 16/16 steps COMPLETED, on the bundle carrying fc1de67 |
| mfa-enroll | FAIL | `maestro:enroll` exit 1 at `scrollUntilVisible id: mfa-submit` (No visible element found), same step as the pre-find-49 run; not retried |
| staff-sign-out | NOT REACHED | runner stopped at mfa-enroll |
| mfa-login | NOT REACHED | runner stopped at mfa-enroll |
| clipboard-scrub | PASS (exit path) | the runner's exit path ran it: 3/3 steps COMPLETED, `maestro:enroll: device clipboard overwritten (process exit)` |

Find 48: no `Fatal signal` in the crash buffer for this run. Find 49: not fixed on the device; the container ships but pads by zero.

Logs left in place: `%TEMP%\hive-signin-kb.log`, `%TEMP%\hive-enroll6.log`, `%TEMP%\hive-enroll6-crash.log` (empty).
