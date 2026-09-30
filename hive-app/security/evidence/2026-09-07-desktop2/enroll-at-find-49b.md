# HIVE device lane — keyboard room measured on the sign-in screen; enrollment runner and sign-in at head 4c6c625, find 49 second iteration (2026-09-07, Kody's Windows desktop, emulator-5554 Pixel_8 API 35)

Operator: local desktop session driven by the cloud coordinator's task. Synthetic data only. No `pm clear`, no rebuild/prebuild, no Metro or emulator restart, no retry of the enrollment runner. Runner OK/FAIL lines, Maestro step lines, adb/git output lines, and error lines only; no token, secret, TOTP key, QR, or clipboard content recorded; no screenshot or hierarchy dump was taken while the authenticator screen was showing.

**Verdict in one line: the second iteration of find 49 is in the served bundle but produces NO keyboard room on this device — with the keyboard shown (IME frame top y=1517, height 883 px) the ScrollView stayed at `[0,295][1080,2400]` and `sign-in-submit` stayed at `[63,952][1017,1089]`; `maestro:enroll` FAIL (exit 1) at the same step as runs 6 and 7, `scrollUntilVisible id: mfa-submit`; sign-in FAIL twice (exit 1) for an infrastructure reason unrelated to the app — the emulator's low-memory killer killed Maestro's on-device driver (`dev.mobile.maestro`) mid-flow. Crash buffer empty (0 bytes, no `Fatal signal`).**

## Git head

```
git fetch origin claude/hive-fable-5-greenfield-p0cwkq
   631f58b..4c6c625  claude/hive-fable-5-greenfield-p0cwkq -> origin/claude/hive-fable-5-greenfield-p0cwkq
git status
On branch claude/hive-fable-5-greenfield-p0cwkq
Your branch is behind 'origin/claude/hive-fable-5-greenfield-p0cwkq' by 1 commit, and can be fast-forwarded.
nothing to commit, working tree clean
git pull --ff-only
Updating 631f58b..4c6c625
Fast-forward
 .../2026-08-22-milestone1-read-only-dashboard.md   |  31 ++++
 hive-app/src/ui/__tests__/screen.test.tsx          | 161 ++++++++++++++++++---
 hive-app/src/ui/primitives/Screen.tsx              |  91 ++++++++++--
 3 files changed, 244 insertions(+), 39 deletions(-)
git log --oneline -1
4c6c625 Find 49, second iteration: keyboard room computed from the reported keyboard height, not the event's screenY (which assumes a resized window)
```

Head 4c6c625 is newer than 631f58b and its message begins "Find 49, second iteration". No wait loop was needed.

```
Select-String -Path src\ui\primitives\Screen.tsx -Pattern "keyboardRoomFor"
33: export function keyboardRoomFor({
123:   const keyboardRoom = keyboardRoomFor({
163:           keyboardRoomFor above): the container measures where it ends and
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
0.044336
(Invoke-WebRequest -UseBasicParsing http://127.0.0.1:54324/api/v1/info).StatusCode
200
Get-ChildItem $env:TEMP -Directory -Filter 'hive-maestro-*'
(nothing)
Get-NetTCPConnection -LocalPort 8477,8478 -State Listen
(nothing)
```

Metro answered `/status` in 0.04 s. Mailpit 200. No stale artifact tree, no helper port listening.

## STEP 2 — warm the new bundle, measure the keyboard room on the sign-in screen, then sign-in

### Bundle

```
adb shell am force-stop com.myhbcfo.hive.development
adb shell monkey -p com.myhbcfo.hive.development -c android.intent.category.LAUNCHER 1
Events injected: 1
(wait 45 s)
cmd /c "adb exec-out uiautomator dump /dev/tty" | Select-String "sign-in-email|brand-wordmark|Choose a workspace|dashboard-workspace" | Select-Object -First 2
brand-wordmark
```

The dump matched `brand-wordmark` and contained `sign-in-email` (chooser and Home absent): the app came up on the sign-in screen on the bundle Metro served after the pull. No scrub lane was needed before measuring.

### Measurement (uiautomator bounds, window 1080×2400 px, density 2.625)

Before the keyboard (dump saved as `%TEMP%\hive-kb-before.xml`):

```
ScrollView (class android.widget.ScrollView, scrollable=false)  bounds=[0,0][1080,2400]
ScrollView (class android.widget.ScrollView, scrollable=true)   bounds=[0,295][1080,2400]   <- the shell's scroll view under the 295 px header band
sign-in-screen                                                  bounds=[0,0][1080,2400]
sign-in-email                                                   bounds=[63,742][1017,889]
sign-in-submit                                                  bounds=[63,952][1017,1089]
```

Open the keyboard:

```
adb shell input tap 540 815        (centre of sign-in-email)
(wait 3 s)
adb shell dumpsys input_method | Select-String "mInputShown"
  mInputShown=true
```

Keyboard geometry from the window manager (`adb shell dumpsys window`):

```
InsetsSource id=3 type=ime frame=[0,1517][1080,2400] visibleFrame=[0,1517][1080,2400] visible=true
InsetsSourceControl mType=ime mInsetsHint=Insets{left=0, top=0, right=0, bottom=883}
```

So the keyboard's top is y=1517 and its height is 883 px (336.4 dp), exactly the value the task expected.

With the keyboard shown — two dumps, the second taken about 20 s after the first (`%TEMP%\hive-kb-after.xml`, `%TEMP%\hive-kb-after2.xml`), identical:

```
ScrollView (scrollable=false)  bounds=[0,0][1080,2400]
ScrollView (scrollable=true)   bounds=[0,295][1080,2400]      <- UNCHANGED (expected bottom ≈ 1517)
sign-in-screen                 bounds=[0,0][1080,2400]
sign-in-email                  bounds=[63,742][1017,889]       <- unchanged
sign-in-submit                 bounds=[63,952][1017,1089]      <- unchanged
```

The `screen-keyboard-room` wrapper (the padded View around the ScrollView in `Screen.tsx`) does not appear in either dump under that resource-id — it is a plain View with only a style, an `onLayout`, and a testID, and the accessibility tree does not expose it — so its own bounds could not be read; the ScrollView it wraps is the observable, and it did not shrink.

Close the keyboard:

```
adb shell input keyevent 111
adb shell dumpsys input_method | Select-String "mInputShown"
  mInputShown=false
```

Result: at this head the keyboard room is still zero on this device. The room is computed from `keyboardHeight` set by the `keyboardDidShow` listener and from the wrapper's `onLayout` bottom; one of those inputs is not arriving (either the event never reaches JS on this edge-to-edge window, or it arrives with a height that yields zero). The measurement cannot tell which from outside.

Reference, React Native 0.86.2 Android (`node_modules/react-native/ReactAndroid/src/main/java/com/facebook/react/ReactRootView.java`, `checkForKeyboardEvents`, invoked from the root view's `onGlobalLayout`): the height is `imeInsets.bottom - barInsets.bottom` from `ViewCompat.getRootWindowInsets(getRootView())`, and the event is only sent when a global layout pass runs. If the window is not resized and no view relayouts when the IME appears, no `onGlobalLayout` fires and the event is never emitted — which would explain a zero room with a correct-looking source. This is a hypothesis, not a measurement.

Attempted runtime diagnosis (bounded, abandoned): I tried to attach to Metro's Hermes inspector target (`/json` lists `React Native Bridgeless [C++ connection]`, page 1) to install a `keyboardDidShow` listener and read `Dimensions.get('window')`. A .NET `ClientWebSocket` failed to connect; Node 22's native WebSocket got HTTP 401 without an `Origin` header (the dev-middleware proxy's `verifyClient` requires an allowed origin) and, with `Origin: http://localhost:8081`, the socket opened and was closed with code 1006 before any CDP reply. No app or repo file was changed; the helper scripts live only in `%TEMP%` (`hive-cdp.ps1`, `hive-cdp.js`).

### sign-in lane

First attempt:

```
cmd /c "maestro test .maestro/sign-in.yaml 2>&1" | Tee-Object -FilePath "$env:TEMP\hive-signin-kb2.log"
exit code: 1
```

Last 30 lines (the whole output):

```
Running on Pixel_8
 > Flow Invite-only OTP sign-in reaches the scoped dashboard
Launch app "com.myhbcfo.hive.development" with clear state... COMPLETED
Assert that id: sign-in-email is visible... COMPLETED
Assert that id: sign-in-email is visible...
==== Debug output (logs & screenshots) ====

C:\Users\kodyr\.maestro\tests\2026-09-07_015449
```

Maestro's own log for that run (`C:\Users\kodyr\.maestro\tests\2026-09-07_015449\maestro.log`):

```
01:55:02.123 [ERROR] maestro.cli.runner.TestRunner.runCatching-ta8aW1Q: Failed to run flow
maestro.android.DeviceServerDiedException: Device server died during 'viewHierarchy' on emulator-5554 (1161ms since last byte, connection age 11638ms): StatusRuntimeException: UNAVAILABLE
Caused by: io.grpc.StatusRuntimeException: UNAVAILABLE
Caused by: java.io.IOException: Command failed (tcp:58100): closed
```

At the same moment the post-lane airplane-mode check itself failed once: `adb shell cmd connectivity airplane-mode` printed `cmd: Can't find service: connectivity` (it printed `disabled` on every other call before and after).

Because the failure was Maestro's device server dying, not an app step, the lane was rerun once (the "do not retry" rule in the task is for the enrollment runner):

```
cmd /c "maestro test .maestro/sign-in.yaml 2>&1" | Tee-Object -FilePath "$env:TEMP\hive-signin-kb2b.log"
exit code: 1
Running on Pixel_8
 > Flow Invite-only OTP sign-in reaches the scoped dashboard
Launch app "com.myhbcfo.hive.development" with clear state...
==== Debug output (logs & screenshots) ====

C:\Users\kodyr\.maestro\tests\2026-09-07_015541
```

```
01:55:49.163 [ERROR] maestro.cli.runner.TestRunner.runCatching-ta8aW1Q: Failed to run flow
maestro.android.DeviceServerDiedException: Device server died during 'launchApp' on emulator-5554 (17ms since last byte, connection age 6284ms): StatusRuntimeException: UNAVAILABLE
```

Cause, from the emulator's logs (`adb logcat -d -b main -b system`, `-b events`):

```
09-07 01:54:50.195 I am_low_memory: 20
09-07 01:54:50.502 I am_kill : [0,31426,com.myhbcfo.hive.development,0,stop com.myhbcfo.hive.development due to clear data,469716]
09-07 01:55:05.560 I am_low_memory: 2
09-07 01:55:44.794 I lowmemorykiller: Kill 'com.google.android.gms.persistent' (3946), uid 10144, oom_score_adj 100 to free 266188kB rss, 0kB swap; reason: min watermark is breached even after kill
09-07 01:55:44.851 I lowmemorykiller: Kill 'com.google.android.apps.wellbeing' (3739), uid 10143, oom_score_adj 0 to free 303608kB rss, 0kB swap; reason: min watermark is breached even after kill
09-07 01:55:45.177 I lowmemorykiller: Kill 'com.google.android.apps.nexuslauncher' (2880), uid 10174, oom_score_adj 0 to free 193504kB rss, 0kB swap; reason: min watermark is breached even after kill
09-07 01:55:45.857 I lowmemorykiller: Kill 'dev.mobile.maestro' (5126), uid 10338, oom_score_adj 0 to free 179924kB rss, 0kB swap; reason: min watermark is breached even after kill
09-07 01:55:45.922 I ActivityManager: Process dev.mobile.maestro (pid 5126) has died: fg  FGS
09-07 01:55:45.923 W ActivityManager: Crash of app dev.mobile.maestro running instrumentation ComponentInfo{dev.mobile.maestro.test/androidx.test.runner.AndroidJUnitRunner}
```

`adb shell free -m` right after: total 2472 MB, used 2306, free 165, swap 210 MB in use. The emulator's RAM (2.4 GB) is at its limit while the dev build launches a fresh bundle with clear state next to the Maestro driver, the Google keyboard, and Google services; the low-memory killer was killing processes at `oom_score_adj 0` (foreground level), and Maestro's driver was one of them. This is the first time a device-server death has appeared in this desktop's Maestro logs (`deviceServerDied=0` in the eight preceding runs, which do carry the same benign `Failed to record heartbeat` file-lock lines). Within a minute of the app being stopped, `dumpsys meminfo` reported `Total RAM: 2,531,944K (status normal)`, `Free RAM: 1,260,691K`, and the runner in STEP 3 then ran to its usual failing step without a driver death.

Post-lane: `adb shell cmd connectivity airplane-mode` → `disabled`.

The heartbeat lines in the Maestro logs (`Failed to record heartbeat ... another process has locked a portion of the file`) appear in every run on this desktop including the passing ones and are not related.

## STEP 3 — enrollment runner

```
adb logcat -c
cmd /c "npm run maestro:enroll 2>&1" | Tee-Object -FilePath "$env:TEMP\hive-enroll7.log"
exit code: 1
final line: maestro:enroll: artifact tree scrubbed (C:\Users\kodyr\AppData\Local\Temp\hive-maestro-enroll-2EqXEE removed and verified gone)
```

Last 40 lines:

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

C:\Users\kodyr\AppData\Local\Temp\hive-maestro-enroll-2EqXEE\artifacts\2026-09-07_015759
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
maestro:enroll: artifact tree scrubbed (C:\Users\kodyr\AppData\Local\Temp\hive-maestro-enroll-2EqXEE removed and verified gone)
```

The failing step is the same as in runs 6 and 7: `scrollUntilVisible id: mfa-submit` after the wrong code is typed with the keyboard up. Not retried. The runner's exit path ran clipboard-scrub (3/3 COMPLETED), revoked the factor (1 deleted, readback zero), and scrubbed the artifact tree. The first 14 steps of mfa-enroll (sign-in, OTP, enrollment screen, secret capture, wrong-code entry) all COMPLETED.

Post-checks:

```
cmd /c "adb logcat -d -b crash > %TEMP%\hive-enroll7-crash.log"
crash buffer: 0 bytes — no `Fatal signal`
adb shell cmd connectivity airplane-mode
disabled
Get-ChildItem $env:TEMP -Directory -Filter 'hive-maestro-*'
(nothing)
Get-NetTCPConnection -LocalPort 8477,8478 -State Listen
(nothing)
```

## Verdict per flow

| flow | verdict | evidence |
|---|---|---|
| mfa-enroll | FAIL | `maestro:enroll` exit 1 at `scrollUntilVisible id: mfa-submit` (No visible element found), same step as runs 6 and 7; not retried |
| staff-sign-out | NOT REACHED | runner stopped at mfa-enroll |
| mfa-login | NOT REACHED | runner stopped at mfa-enroll |
| clipboard-scrub | PASS (exit path) | the runner's exit path ran it: 3/3 steps COMPLETED, `maestro:enroll: device clipboard overwritten (process exit)` |
| sign-in | FAIL (infrastructure) | exit 1 twice, both `DeviceServerDiedException`: the emulator's low-memory killer killed `dev.mobile.maestro`; no app step failed; the same flow's first 14 steps passed inside the runner minutes later |

## What the coordinator should take from this run

1. The second iteration does not change the observable on the device: zero keyboard room on the sign-in screen with the keyboard measurably at y=1517 / 883 px. The next iteration needs an on-device observation of what `keyboardDidShow` delivers (or whether it fires) under this edge-to-edge window, rather than another derivation from the RN source. A one-line dev-only `console.log` of the event payload and of the wrapper's `onLayout` in `Screen.tsx`, read from `adb logcat -s ReactNativeJS`, would settle it on the next launch; the inspector route is blocked by the dev-middleware origin check and an immediate 1006 close.
2. The emulator's 2.4 GB RAM is now the flakiest part of the lane: the low-memory killer reached foreground processes during a clear-state launch. Nothing was restarted or reconfigured in this session; a larger RAM allocation for this AVD is Kody's call.
