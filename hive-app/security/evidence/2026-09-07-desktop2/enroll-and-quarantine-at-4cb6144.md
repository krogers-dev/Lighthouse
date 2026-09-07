# HIVE device lane — enrollment runner, sign-in and the quarantine flow with logcat counts at head 4cb6144 (2026-09-07, Kody's Windows desktop, emulator-5554 Pixel_8 API 35)

Operator: local desktop session driven by the cloud coordinator's task (run 10). Synthetic data only. No `pm clear`, no rebuild/prebuild, no emulator restart, no Metro restart (the pull touched README and docs only; the launch check below passed). Runner OK/FAIL lines, Maestro step lines, adb/git output lines, error class names, counts, and the QA keyboard hook's own marker lines (numbers only) are recorded; no token, secret, TOTP key, QR, clipboard content, or any other app log line. No screenshot or hierarchy dump was taken at any point in this run.

**Verdict in one line: at head 4cb6144 the enrollment runner passed twice (`maestro:enroll OK`, exit 0, 154 s and 157 s: mfa-enroll, staff-sign-out and mfa-login all completed, so finds 30/37/47/49 are device-confirmed on the enrollment and login screens), `sign-in.yaml` passed (exit 0, 37 s), and `quarantine-recovery.yaml` passed (exit 0, 30 s) with a clean `ReactNativeJS` log: 0 `Auto refresh tick failed`, 0 `QuarantineRequiredError`, 0 `Uncaught`, 0 unhandled-rejection lines, 0 error class names of any kind, 0 crash bytes (find 46 device-confirmed). The keyboard hook reported `height=312 … room=336` on every email field and `height=268 … room=292` on every OTP and TOTP field, on the sign-in, enrollment and login screens alike. One tooling fact for the runbook: Maestro's Android driver clears logcat at every flow start, so a post-runner `adb logcat -d` holds only the last flow's lines; a live `adb logcat -s ReactNativeJS` stream was needed to capture the enrollment-screen hook lines.**

## STEP 1 — state check (verbatim, before the pull)

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
Get-NetTCPConnection -LocalPort 8081 -State Listen
LocalAddress LocalPort OwningProcess
::                8081         60124
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8081/status   (body decoded from Byte[])
status body: packager-status:running http=200 ms=27
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:54324/api/v1/info
mailpit http=200
Get-ChildItem $env:TEMP -Directory -Filter 'hive-maestro-*'
hive-maestro dirs: 0
Get-NetTCPConnection -State Listen | Where-Object { $_.LocalPort -in 8477,8478 }
8477/8478 listeners: 0
adb shell dumpsys meminfo | Select-String "Total RAM|Free RAM|Used RAM"
Total RAM: 2,531,944K (status normal)
 Free RAM: 1,042,717K (  237,361K cached pss +   657,660K cached kernel +   147,696K free)
 Used RAM: 1,658,565K (1,424,061K used pss +   234,504K kernel)
adb shell free -m
		total        used        free      shared     buffers
Mem:             2472        2329         143          23          13
-/+ buffers/cache:           2315         156
Swap:            1854         295        1558
```

Metro is the pid 60124 instance run 9 started (CI=1, EXPO_PUBLIC_QA_HOOKS=1, log at `%TEMP%\hive-metro.log`). `free -m` shows 143 MB free while `dumpsys meminfo` counts 1,042,717K reclaimable; this run's gate uses the latter, as the task said.

## STEP 2 — pull the head, then the find 50 launch check

```
git fetch origin claude/hive-fable-5-greenfield-p0cwkq
 * branch            claude/hive-fable-5-greenfield-p0cwkq -> FETCH_HEAD
   eb425a1..4cb6144  claude/hive-fable-5-greenfield-p0cwkq -> origin/claude/hive-fable-5-greenfield-p0cwkq
git status
On branch claude/hive-fable-5-greenfield-p0cwkq
Your branch is behind 'origin/claude/hive-fable-5-greenfield-p0cwkq' by 1 commit, and can be fast-forwarded.
nothing to commit, working tree clean
git pull --ff-only
Updating eb425a1..4cb6144
Fast-forward
 hive-app/README.md                                 |  6 +++
 .../2026-08-22-milestone1-read-only-dashboard.md   | 58 ++++++++++++++++++++++
 2 files changed, 64 insertions(+)
git log --oneline -1
4cb6144 Record: run 9 — the keyboard room works on the device (find 49 device-confirmed on the sign-in screen); runs 7 and 8 measured a stale Metro bundle (find 50, runbook)
```

Head 4cb6144, subject beginning "Record: run 9", as expected. README and docs only; `metro.config.js` unchanged; Metro NOT restarted.

Launch check (find 50 rule):

```
adb logcat -c
adb shell am force-stop com.myhbcfo.hive.development
adb shell monkey -p com.myhbcfo.hive.development -c android.intent.category.LAUNCHER 1
Events injected: 1
(host clock at launch: 02:40:06.852; waited 45 s)
Select-String -Path $env:TEMP\hive-metro.log -Pattern 'Android Bundled' | Select-Object -Last 2
Android Bundled 3680ms node_modules\expo-router\entry.js (1690 modules)
Android Bundled 36ms node_modules\expo-router\entry.js (1 module)
(Metro log LastWriteTime 02:40:12.969, 35 lines; the "(1 module)" line was written by this launch)
adb logcat -d -s ReactNativeJS | Select-String HIVE_QA_KEYBOARD_HOOK
09-07 02:40:10.749 11674 11714 I ReactNativeJS: HIVE_QA_KEYBOARD_HOOK installed platform=android window=411x914 screen=411x914
09-07 02:40:10.772 11674 11714 I ReactNativeJS: HIVE_QA_KEYBOARD_HOOK room platform=android windowHeight=914 containerBottom=914 keyboardHeight=0 bottomInset=24 room=0
09-07 02:40:11.022 11674 11714 I ReactNativeJS: HIVE_QA_KEYBOARD_HOOK room platform=android windowHeight=914 containerBottom=null keyboardHeight=0 bottomInset=24 room=0
09-07 02:40:11.066 11674 11714 I ReactNativeJS: HIVE_QA_KEYBOARD_HOOK room platform=android windowHeight=914 containerBottom=914 keyboardHeight=0 bottomInset=24 room=0
```

The newest `Android Bundled` line IS a `(1 module)` line, but it was produced by this launch against a Metro whose last full build (1690 modules, run 9's restart) already carried the hook, and the pull changed no JavaScript, so a 1-module delta is the correct answer here. The decisive check, the `installed` line, is present. Per the task's remedy clause (restart only if the `installed` line is missing) Metro was left running. No restart was needed.

## Memory gate readings (`dumpsys meminfo` Free RAM; threshold 600,000K)

| before | host time | Free RAM | result |
|---|---|---|---|
| STEP 3 (runner, first pass) | 02:41:39 | 1,032,652K (234,024K cached pss + 658,884K cached kernel + 139,744K free) | proceed |
| STEP 4 (sign-in) | 02:45:27 | 1,098,653K (430,189K cached pss + 366,956K cached kernel + 301,508K free) | proceed |
| STEP 5 (quarantine) | 02:46:25 | 1,000,133K (330,597K cached pss + 391,928K cached kernel + 277,608K free) | proceed |
| supplementary runner rerun | 02:47:54 | 1,076,922K (263,770K cached pss + 536,116K cached kernel + 277,036K free) | proceed |
| closing | 02:51:20 | 1,086,059K (445,539K cached pss + 295,844K cached kernel + 344,676K free) | — |

No re-read was needed at any gate. `adb logcat -d -b system | Select-String lowmemorykiller` returned nothing after every flow.

## STEP 3 — the enrollment runner (finds 30/37/47/49), first pass

```
adb logcat -c
cmd /c "npm run maestro:enroll 2>&1" | Tee-Object -FilePath "$env:TEMP\hive-enroll10.log"
EXIT=0 elapsed=154s
final line:
maestro:enroll OK — reset -> enroll -> sign-out -> login on the SAME factor -> revoke completed sequentially; helper terminated, clipboard scrubbed, artifacts confined and removed
```

Last 40 lines of `hive-enroll10.log`:

```
Assert that id: settings-screen is visible... COMPLETED
Scrolling DOWN until id: settings-sign-out is visible with speed 40, visibility percentage 100%, timeout 20000 ms, with centering disabled... COMPLETED
Tap on id: settings-sign-out... COMPLETED
Assert that id: sign-in-email is visible... COMPLETED
Stop com.myhbcfo.hive.development... COMPLETED
Launch app "com.myhbcfo.hive.development"... COMPLETED
Assert that id: sign-in-email is visible... COMPLETED
Assert that id: dashboard-workspace is not visible... COMPLETED
maestro:enroll: running mfa-login.yaml (sequential; artifacts confined to C:\Users\kodyr\AppData\Local\Temp\hive-maestro-enroll-keEwLS; watchdog 600000ms)
Running on Pixel_8
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
Scrolling DOWN until id: mfa-submit is visible with speed 40, visibility percentage 100%, timeout 20000 ms, with centering disabled... COMPLETED
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
maestro:enroll: artifact tree scrubbed (C:\Users\kodyr\AppData\Local\Temp\hive-maestro-enroll-keEwLS removed and verified gone)
maestro:enroll OK — reset -> enroll -> sign-out -> login on the SAME factor -> revoke completed sequentially; helper terminated, clipboard scrubbed, artifacts confined and removed
```

The find 47 step (`Scrolling DOWN until id: mfa-submit is visible … visibility percentage 100%`) and the tap that follows it COMPLETED in both mfa-enroll and mfa-login; that is the step that failed at bd2be6c and e92c133 with the keyboard open.

After the runner:

```
cmd /c "adb logcat -d -b crash > %TEMP%\hive-enroll10-crash.log"
crash bytes: 0 FatalSignal=False
adb logcat -d -s ReactNativeJS | Select-String HIVE_QA_KEYBOARD_HOOK
09-07 02:44:16.439 15131 15182 I ReactNativeJS: HIVE_QA_KEYBOARD_HOOK installed platform=android window=411x914 screen=411x914
09-07 02:44:16.560 15131 15182 I ReactNativeJS: HIVE_QA_KEYBOARD_HOOK room platform=android windowHeight=914 containerBottom=914 keyboardHeight=0 bottomInset=24 room=0
09-07 02:44:16.719 15131 15182 I ReactNativeJS: HIVE_QA_KEYBOARD_HOOK room platform=android windowHeight=914 containerBottom=null keyboardHeight=0 bottomInset=24 room=0
09-07 02:44:16.726 15131 15182 I ReactNativeJS: HIVE_QA_KEYBOARD_HOOK room platform=android windowHeight=914 containerBottom=914 keyboardHeight=0 bottomInset=24 room=0
adb logcat -g
main: ring buffer is 2 MiB (582 KiB consumed, 532 KiB readable), max entry is 5120 B, max payload is 4068 B
(main buffer: 3387 lines, earliest entry 09-07 02:44:09.139, 5 ReactNativeJS lines; no wrap)
adb shell cmd connectivity airplane-mode
disabled
hive-maestro dirs: 0
8477/8478 listeners: 0
```

Only the clipboard-scrub launch's four hook lines (pid 15131, clear state at 02:44:09) survived: the main buffer's earliest entry is 02:44:09.139, the instant of that last flow's launch, although the buffer had not wrapped and no `logcat -c` exists anywhere in `scripts/` or `.maestro/`. The same thing was then seen on the bare `maestro test` runs of STEP 4 and STEP 5 (earliest entry = that flow's launch instant, several seconds after this session's own `logcat -c`), so it is Maestro's Android driver clearing logcat at flow start for its per-flow `device-logcat.txt`. The runner's hook lines from the enrollment and login screens were therefore not observable from a dump; see the supplementary rerun below, captured through a live stream.

Low-memory events during the first runner pass (`adb logcat -d -b events | Select-String "am_low_memory|am_kill"`, 02:41:39 to 02:44:38; process names and numbers only):

```
09-07 02:41:54.078 32303 32625 I am_kill : [0,11674,com.myhbcfo.hive.development,0,stop com.myhbcfo.hive.development due to clear data,463208]
09-07 02:41:54.120 32303 32516 I am_low_memory: 18
09-07 02:42:53.271 32303 32342 I am_kill : [0,11910,dev.mobile.maestro,0,stop dev.mobile.maestro due to deletePackageX,160280]
09-07 02:42:55.131 32303  1834 I am_low_memory: 17
09-07 02:42:55.240 32303 32516 I am_low_memory: 17
09-07 02:42:58.866 32303   900 I am_kill : [0,12320,com.myhbcfo.hive.development,0,stop com.myhbcfo.hive.development due to from pid 13271,499616]
09-07 02:43:11.896 32303  1039 I am_kill : [0,13279,com.myhbcfo.hive.development,0,stop com.myhbcfo.hive.development due to from pid 13365,475760]
09-07 02:43:20.737 32303 32342 I am_kill : [0,13061,dev.mobile.maestro,0,stop dev.mobile.maestro due to deletePackageX,157956]
09-07 02:43:24.724 32303  1489 I am_low_memory: 20
09-07 02:43:26.110 32303  1039 I am_kill : [0,13431,com.myhbcfo.hive.development,0,stop com.myhbcfo.hive.development due to from pid 13970,465816]
09-07 02:44:03.090 32303 32342 I am_kill : [0,13886,dev.mobile.maestro,0,stop dev.mobile.maestro due to deletePackageX,164484]
09-07 02:44:04.621 32303  1039 I am_low_memory: 18
09-07 02:44:04.769 32303   928 I am_low_memory: 17
09-07 02:44:08.983 32303  1834 I am_low_memory: 21
09-07 02:44:09.093 32303  1701 I am_low_memory: 20
09-07 02:44:09.274 32303 32322 I am_kill : [0,13979,com.myhbcfo.hive.development,0,stop com.myhbcfo.hive.development due to clear data,482652]
09-07 02:44:18.476 32303 32342 I am_kill : [0,14771,dev.mobile.maestro,0,stop dev.mobile.maestro due to deletePackageX,167920]
```

Every `am_kill` of the app is an explicit stop (Maestro's `clear data` or `stopApp`, "due to from pid" = the flow's own stop), never an OOM kill; the `am_low_memory: N` lines are the activity manager's count of cached processes at trim time, and no `lowmemorykiller` line appeared in the system buffer. The events buffer also still held older entries from 01:36 to 02:40 (earlier sessions today; same pattern, no kill of the app by the memory killer).

## STEP 4 — sign-in

```
adb logcat -c
cmd /c "maestro test .maestro\sign-in.yaml 2>&1" | Tee-Object -FilePath "$env:TEMP\hive-signin10.log"
EXIT=0 elapsed=37s
```

Last 30 lines of `hive-signin10.log` (the whole log is 16 lines):

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

No `DeviceServerDiedException`; no rerun.

Hook lines during sign-in (`adb logcat -d -s ReactNativeJS | Select-String HIVE_QA_KEYBOARD_HOOK`, identical in the live stream):

```
09-07 02:45:46.397 15878 15914 I ReactNativeJS: HIVE_QA_KEYBOARD_HOOK installed platform=android window=411x914 screen=411x914
09-07 02:45:46.526 15878 15914 I ReactNativeJS: HIVE_QA_KEYBOARD_HOOK room platform=android windowHeight=914 containerBottom=914 keyboardHeight=0 bottomInset=24 room=0
09-07 02:45:46.614 15878 15914 I ReactNativeJS: HIVE_QA_KEYBOARD_HOOK room platform=android windowHeight=914 containerBottom=null keyboardHeight=0 bottomInset=24 room=0
09-07 02:45:46.657 15878 15914 I ReactNativeJS: HIVE_QA_KEYBOARD_HOOK room platform=android windowHeight=914 containerBottom=914 keyboardHeight=0 bottomInset=24 room=0
09-07 02:45:49.574 15878 15914 I ReactNativeJS: HIVE_QA_KEYBOARD_HOOK event=keyboardDidShow platform=android height=312 screenY=578 screenX=0 width=411 window=411x914 screen=411x914
09-07 02:45:49.582 15878 15914 I ReactNativeJS: HIVE_QA_KEYBOARD_HOOK room platform=android windowHeight=914 containerBottom=914 keyboardHeight=312 bottomInset=24 room=336
09-07 02:45:59.752 15878 15914 I ReactNativeJS: HIVE_QA_KEYBOARD_HOOK room platform=android windowHeight=914 containerBottom=null keyboardHeight=0 bottomInset=24 room=0
09-07 02:45:59.766 15878 15914 I ReactNativeJS: HIVE_QA_KEYBOARD_HOOK room platform=android windowHeight=914 containerBottom=914 keyboardHeight=0 bottomInset=24 room=0
09-07 02:45:59.771 15878 15914 I ReactNativeJS: HIVE_QA_KEYBOARD_HOOK event=keyboardDidHide platform=android height=0 screenY=914 screenX=0 width=411 window=411x914 screen=411x914
09-07 02:46:02.995 15878 15914 I ReactNativeJS: HIVE_QA_KEYBOARD_HOOK event=keyboardDidShow platform=android height=268 screenY=622 screenX=0 width=411 window=411x914 screen=411x914
09-07 02:46:02.999 15878 15914 I ReactNativeJS: HIVE_QA_KEYBOARD_HOOK room platform=android windowHeight=914 containerBottom=914 keyboardHeight=268 bottomInset=24 room=292
09-07 02:46:07.322 15878 15914 I ReactNativeJS: HIVE_QA_KEYBOARD_HOOK event=keyboardDidHide platform=android height=0 screenY=914 screenX=0 width=411 window=411x914 screen=411x914
09-07 02:46:07.392 15878 15914 I ReactNativeJS: HIVE_QA_KEYBOARD_HOOK room platform=android windowHeight=914 containerBottom=914 keyboardHeight=0 bottomInset=24 room=0
09-07 02:46:07.665 15878 15914 I ReactNativeJS: HIVE_QA_KEYBOARD_HOOK room platform=android windowHeight=914 containerBottom=null keyboardHeight=0 bottomInset=24 room=0
09-07 02:46:07.709 15878 15914 I ReactNativeJS: HIVE_QA_KEYBOARD_HOOK room platform=android windowHeight=914 containerBottom=914 keyboardHeight=0 bottomInset=24 room=0
09-07 02:46:10.142 15878 15914 I ReactNativeJS: HIVE_QA_KEYBOARD_HOOK room platform=android windowHeight=914 containerBottom=null keyboardHeight=0 bottomInset=24 room=0
09-07 02:46:10.165 15878 15914 I ReactNativeJS: HIVE_QA_KEYBOARD_HOOK room platform=android windowHeight=914 containerBottom=826 keyboardHeight=0 bottomInset=24 room=0
```

The email field raised the full keyboard (`height=312`, `room=336`, as in run 9); the OTP field raised the number pad (`height=268`, `screenY=622`, `room=292`). `containerBottom=826` at the end coincides with the dashboard inside the tab shell (88 dp less than the window).

After sign-in:

```
adb logcat -d -b events | Select-String "am_low_memory|am_kill"   (since 02:45:27)
09-07 02:45:38.907 32303 32733 I am_low_memory: 20
09-07 02:45:39.137 32303 32733 I am_kill : [0,15131,com.myhbcfo.hive.development,0,stop com.myhbcfo.hive.development due to clear data,461280]
09-07 02:46:11.682 32303 32342 I am_kill : [0,15613,dev.mobile.maestro,0,stop dev.mobile.maestro due to deletePackageX,162032]
adb logcat -d -b system | Select-String lowmemorykiller
(nothing)
adb logcat -d -b crash
0 bytes
adb shell cmd connectivity airplane-mode
disabled
hive-maestro dirs: 0
8477/8478: 0
(main buffer earliest entry after the flow: 09-07 02:45:39.134 = the flow's launch instant)
```

## STEP 5 — the quarantine flow with logcat counts (find 46)

STEP 4 passed and left the app signed in, so the flow ran directly.

```
adb logcat -c
cmd /c "maestro test .maestro\quarantine-recovery.yaml 2>&1" | Tee-Object -FilePath "$env:TEMP\hive-quarantine10.log"
EXIT=0 elapsed=30s
```

Last 30 lines of `hive-quarantine10.log` (the whole log is 18 lines):

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

No `DeviceServerDiedException`; no rerun.

Logcat counts (`adb logcat -d -s ReactNativeJS > $env:TEMP\hive-quarantine10-js.log`; the buffer's earliest entry was 02:46:57.724, the flow's first launch, so the dump covers the whole flow including the in-flow stop and relaunch, pids 16681 and 16864):

| pattern | count |
|---|---|
| `Auto refresh tick failed` | 0 |
| `QuarantineRequiredError` | 0 |
| `Uncaught` | 0 |
| `Possible unhandled promise rejection` / `Possible Unhandled Promise Rejection` | 0 |
| `storage_quarantine_entered` | 0 |
| any word ending in `Error` (error class names) | 0 |
| any of `error`, `exception`, `fail`, `reject` (case-insensitive) in a non-hook line | 0 |
| `HIVE_QA_KEYBOARD_HOOK` lines | 16 |
| React Native `Running "main"` bootstrap lines (one per launch; length 113 each) | 2 |
| logcat buffer header line (`--------- beginning of …`) | 1 |
| total lines in the file | 19 |

The live stream held the same 18 non-header lines for the flow's window, with the same zero error classes. Every hook line, as-is:

```
09-07 02:47:04.585 16681 16756 I ReactNativeJS: HIVE_QA_KEYBOARD_HOOK installed platform=android window=411x914 screen=411x914
09-07 02:47:04.690 16681 16756 I ReactNativeJS: HIVE_QA_KEYBOARD_HOOK room platform=android windowHeight=914 containerBottom=914 keyboardHeight=0 bottomInset=24 room=0
09-07 02:47:05.772 16681 16756 I ReactNativeJS: HIVE_QA_KEYBOARD_HOOK room platform=android windowHeight=914 containerBottom=null keyboardHeight=0 bottomInset=24 room=0
09-07 02:47:05.816 16681 16756 I ReactNativeJS: HIVE_QA_KEYBOARD_HOOK room platform=android windowHeight=914 containerBottom=914 keyboardHeight=0 bottomInset=24 room=0
09-07 02:47:08.156 16681 16756 I ReactNativeJS: HIVE_QA_KEYBOARD_HOOK room platform=android windowHeight=914 containerBottom=null keyboardHeight=0 bottomInset=24 room=0
09-07 02:47:08.166 16681 16756 I ReactNativeJS: HIVE_QA_KEYBOARD_HOOK room platform=android windowHeight=914 containerBottom=826 keyboardHeight=0 bottomInset=24 room=0
09-07 02:47:09.333 16681 16756 I ReactNativeJS: HIVE_QA_KEYBOARD_HOOK room platform=android windowHeight=914 containerBottom=null keyboardHeight=0 bottomInset=24 room=0
09-07 02:47:09.385 16681 16756 I ReactNativeJS: HIVE_QA_KEYBOARD_HOOK room platform=android windowHeight=914 containerBottom=826 keyboardHeight=0 bottomInset=24 room=0
09-07 02:47:09.418 16681 16756 I ReactNativeJS: HIVE_QA_KEYBOARD_HOOK room platform=android windowHeight=914 containerBottom=null keyboardHeight=0 bottomInset=24 room=0
09-07 02:47:09.423 16681 16756 I ReactNativeJS: HIVE_QA_KEYBOARD_HOOK room platform=android windowHeight=914 containerBottom=894 keyboardHeight=0 bottomInset=24 room=0
09-07 02:47:18.153 16864 16903 I ReactNativeJS: HIVE_QA_KEYBOARD_HOOK installed platform=android window=411x914 screen=411x914
09-07 02:47:18.174 16864 16903 I ReactNativeJS: HIVE_QA_KEYBOARD_HOOK room platform=android windowHeight=914 containerBottom=914 keyboardHeight=0 bottomInset=24 room=0
09-07 02:47:18.342 16864 16903 I ReactNativeJS: HIVE_QA_KEYBOARD_HOOK room platform=android windowHeight=914 containerBottom=null keyboardHeight=0 bottomInset=24 room=0
09-07 02:47:18.398 16864 16903 I ReactNativeJS: HIVE_QA_KEYBOARD_HOOK room platform=android windowHeight=914 containerBottom=914 keyboardHeight=0 bottomInset=24 room=0
09-07 02:47:21.397 16864 16903 I ReactNativeJS: HIVE_QA_KEYBOARD_HOOK room platform=android windowHeight=914 containerBottom=null keyboardHeight=0 bottomInset=24 room=0
09-07 02:47:21.413 16864 16903 I ReactNativeJS: HIVE_QA_KEYBOARD_HOOK room platform=android windowHeight=914 containerBottom=914 keyboardHeight=0 bottomInset=24 room=0
```

No keyboard was raised in this flow (no `event=` line), as expected; `containerBottom=894` at 02:47:09.423 coincides with the deep-link acknowledgement step (20 dp less than the window), and `914` follows the relaunch onto the quarantine screen.

After the flow:

```
adb logcat -d -b crash
0 bytes
adb logcat -d -b events | Select-String "am_low_memory|am_kill"   (since 02:46:30)
09-07 02:46:57.107 32303   928 I am_low_memory: 20
09-07 02:46:57.756 32303 32585 I am_low_memory: 19
09-07 02:46:58.273 32303 32585 I am_kill : [0,15878,com.myhbcfo.hive.development,0,stop com.myhbcfo.hive.development due to from pid 16672,484272]
09-07 02:47:10.414 32303 32432 I am_kill : [0,16681,com.myhbcfo.hive.development,0,stop com.myhbcfo.hive.development due to from pid 16797,474976]
09-07 02:47:23.238 32303 32342 I am_kill : [0,16548,dev.mobile.maestro,0,stop dev.mobile.maestro due to deletePackageX,162144]
adb logcat -d -b system | Select-String lowmemorykiller
(nothing)
adb shell cmd connectivity airplane-mode
disabled
hive-maestro dirs: 0
8477/8478: 0
```

The two app kills are the flow's own launch (`from pid 16672`, Maestro's launch replacing the signed-in process) and its `Stop` step (`from pid 16797`).

## Supplementary — the enrollment runner again, captured through a live stream

Because Maestro's per-flow logcat clear had erased the first pass's enrollment-screen hook lines, and the task asked for them (expected show/hide pairs with `room=336` on the enrollment screen), the runner was run a second time with `adb logcat -v time -s ReactNativeJS` streaming to `%TEMP%\hive-live-js10.log` from 02:45:27 onward (the stream was started before STEP 4 and stopped after this pass). This is not a retry: the first pass had passed. Gate reading before it: 1,076,922K at 02:47:54.

```
adb logcat -c
cmd /c "npm run maestro:enroll 2>&1" | Tee-Object -FilePath "$env:TEMP\hive-enroll10b.log"
EXIT=0 elapsed=157s started=02:48:31
maestro:enroll: running mfa-enroll.yaml (sequential; artifacts confined to C:\Users\kodyr\AppData\Local\Temp\hive-maestro-enroll-RCHYrv; watchdog 600000ms)
maestro:enroll: running staff-sign-out.yaml (sequential; artifacts confined to C:\Users\kodyr\AppData\Local\Temp\hive-maestro-enroll-RCHYrv; watchdog 600000ms)
maestro:enroll: running mfa-login.yaml (sequential; artifacts confined to C:\Users\kodyr\AppData\Local\Temp\hive-maestro-enroll-RCHYrv; watchdog 600000ms)
maestro:enroll: device clipboard overwritten (success)
maestro:enroll: artifact tree scrubbed (C:\Users\kodyr\AppData\Local\Temp\hive-maestro-enroll-RCHYrv removed and verified gone)
maestro:enroll OK — reset -> enroll -> sign-out -> login on the SAME factor -> revoke completed sequentially; helper terminated, clipboard scrubbed, artifacts confined and removed
```

Live-stream lines from 02:48:31 to the end of the pass: 68 in total; 63 hook lines (5 `installed`, 7 `keyboardDidShow`, 7 `keyboardDidHide`, 7 `room` lines with nonzero room, 37 `room=0` lines); 5 non-hook lines, all of them React Native `Running "main"` bootstrap lines (one per launch); 0 error class names; 0 lines carrying `error`, `exception`, `fail` or `reject`. The `installed`, `event=` and nonzero-`room` lines, as-is (the 37 `room=0` lines are omitted for length; each show has its `room=0` counterpart after the hide):

```
09-07 02:48:45.753 I/ReactNativeJS(17783): HIVE_QA_KEYBOARD_HOOK installed platform=android window=411x914 screen=411x914
09-07 02:48:49.114 I/ReactNativeJS(17783): HIVE_QA_KEYBOARD_HOOK event=keyboardDidShow platform=android height=312 screenY=578 screenX=0 width=411 window=411x914 screen=411x914
09-07 02:48:49.129 I/ReactNativeJS(17783): HIVE_QA_KEYBOARD_HOOK room platform=android windowHeight=914 containerBottom=914 keyboardHeight=312 bottomInset=24 room=336
09-07 02:48:59.527 I/ReactNativeJS(17783): HIVE_QA_KEYBOARD_HOOK event=keyboardDidHide platform=android height=0 screenY=914 screenX=0 width=411 window=411x914 screen=411x914
09-07 02:49:03.522 I/ReactNativeJS(17783): HIVE_QA_KEYBOARD_HOOK event=keyboardDidShow platform=android height=268 screenY=622 screenX=0 width=411 window=411x914 screen=411x914
09-07 02:49:03.532 I/ReactNativeJS(17783): HIVE_QA_KEYBOARD_HOOK room platform=android windowHeight=914 containerBottom=914 keyboardHeight=268 bottomInset=24 room=292
09-07 02:49:08.113 I/ReactNativeJS(17783): HIVE_QA_KEYBOARD_HOOK event=keyboardDidHide platform=android height=0 screenY=914 screenX=0 width=411 window=411x914 screen=411x914
09-07 02:49:12.296 I/ReactNativeJS(17783): HIVE_QA_KEYBOARD_HOOK event=keyboardDidShow platform=android height=268 screenY=622 screenX=0 width=411 window=411x914 screen=411x914
09-07 02:49:12.304 I/ReactNativeJS(17783): HIVE_QA_KEYBOARD_HOOK room platform=android windowHeight=914 containerBottom=914 keyboardHeight=268 bottomInset=24 room=292
09-07 02:49:18.880 I/ReactNativeJS(17783): HIVE_QA_KEYBOARD_HOOK event=keyboardDidHide platform=android height=0 screenY=914 screenX=0 width=411 window=411x914 screen=411x914
09-07 02:49:22.258 I/ReactNativeJS(17783): HIVE_QA_KEYBOARD_HOOK event=keyboardDidShow platform=android height=268 screenY=622 screenX=0 width=411 window=411x914 screen=411x914
09-07 02:49:22.281 I/ReactNativeJS(17783): HIVE_QA_KEYBOARD_HOOK room platform=android windowHeight=914 containerBottom=914 keyboardHeight=268 bottomInset=24 room=292
09-07 02:49:36.545 I/ReactNativeJS(17783): HIVE_QA_KEYBOARD_HOOK event=keyboardDidHide platform=android height=0 screenY=914 screenX=0 width=411 window=411x914 screen=411x914
09-07 02:49:49.585 I/ReactNativeJS(18624): HIVE_QA_KEYBOARD_HOOK installed platform=android window=411x914 screen=411x914
09-07 02:50:04.473 I/ReactNativeJS(18838): HIVE_QA_KEYBOARD_HOOK installed platform=android window=411x914 screen=411x914
09-07 02:50:17.872 I/ReactNativeJS(19636): HIVE_QA_KEYBOARD_HOOK installed platform=android window=411x914 screen=411x914
09-07 02:50:20.557 I/ReactNativeJS(19636): HIVE_QA_KEYBOARD_HOOK event=keyboardDidShow platform=android height=312 screenY=578 screenX=0 width=411 window=411x914 screen=411x914
09-07 02:50:20.573 I/ReactNativeJS(19636): HIVE_QA_KEYBOARD_HOOK room platform=android windowHeight=914 containerBottom=914 keyboardHeight=312 bottomInset=24 room=336
09-07 02:50:31.050 I/ReactNativeJS(19636): HIVE_QA_KEYBOARD_HOOK event=keyboardDidHide platform=android height=0 screenY=914 screenX=0 width=411 window=411x914 screen=411x914
09-07 02:50:34.416 I/ReactNativeJS(19636): HIVE_QA_KEYBOARD_HOOK event=keyboardDidShow platform=android height=268 screenY=622 screenX=0 width=411 window=411x914 screen=411x914
09-07 02:50:34.425 I/ReactNativeJS(19636): HIVE_QA_KEYBOARD_HOOK room platform=android windowHeight=914 containerBottom=914 keyboardHeight=268 bottomInset=24 room=292
09-07 02:50:38.632 I/ReactNativeJS(19636): HIVE_QA_KEYBOARD_HOOK event=keyboardDidHide platform=android height=0 screenY=914 screenX=0 width=411 window=411x914 screen=411x914
09-07 02:50:42.312 I/ReactNativeJS(19636): HIVE_QA_KEYBOARD_HOOK event=keyboardDidShow platform=android height=268 screenY=622 screenX=0 width=411 window=411x914 screen=411x914
09-07 02:50:42.318 I/ReactNativeJS(19636): HIVE_QA_KEYBOARD_HOOK room platform=android windowHeight=914 containerBottom=914 keyboardHeight=268 bottomInset=24 room=292
09-07 02:50:46.615 I/ReactNativeJS(19636): HIVE_QA_KEYBOARD_HOOK event=keyboardDidHide platform=android height=0 screenY=914 screenX=0 width=411 window=411x914 screen=411x914
09-07 02:51:02.916 I/ReactNativeJS(20279): HIVE_QA_KEYBOARD_HOOK installed platform=android window=411x914 screen=411x914
```

Reading: pid 17783 is `mfa-enroll.yaml` (email field 312/336; OTP number pad 268/292; TOTP code field 268/292 twice, the wrong code then the right one, the second show at 02:49:22 closing at 02:49:36 around the find 47 scroll and the `mfa-submit` tap). Pids 18624 and 18838 are `staff-sign-out.yaml`'s launches (no keyboard). Pid 19636 is `mfa-login.yaml` (email 312/336, OTP 268/292, TOTP 268/292 once: no second QR, one code). Pid 20279 is the clipboard scrub (clear state). Every show reported a nonzero `room` within about 10 to 25 ms, and every hide was followed by `room=0`.

After the pass:

```
adb logcat -d -b crash
0 bytes
adb logcat -d -b events | Select-String "am_low_memory|am_kill"   (since 02:48:31)
09-07 02:48:37.932 32303 32625 I am_kill : [0,16864,com.myhbcfo.hive.development,0,stop com.myhbcfo.hive.development due to clear data,466796]
09-07 02:49:38.240 32303 32342 I am_kill : [0,17549,dev.mobile.maestro,0,stop dev.mobile.maestro due to deletePackageX,162860]
09-07 02:49:43.511 32303   948 I am_kill : [0,17783,com.myhbcfo.hive.development,0,stop com.myhbcfo.hive.development due to from pid 18615,498476]
09-07 02:49:57.054 32303 32376 I am_kill : [0,18624,com.myhbcfo.hive.development,0,stop com.myhbcfo.hive.development due to from pid 18772,476592]
09-07 02:50:06.529 32303 32342 I am_kill : [0,18382,dev.mobile.maestro,0,stop dev.mobile.maestro due to deletePackageX,158564]
09-07 02:50:11.690 32303   948 I am_kill : [0,18838,com.myhbcfo.hive.development,0,stop com.myhbcfo.hive.development due to from pid 19627,464160]
09-07 02:50:48.482 32303 32342 I am_kill : [0,19392,dev.mobile.maestro,0,stop dev.mobile.maestro due to deletePackageX,159476]
09-07 02:50:55.059 32303  2547 I am_kill : [0,19636,com.myhbcfo.hive.development,0,stop com.myhbcfo.hive.development due to clear data,482416]
09-07 02:51:05.309 32303 32342 I am_kill : [0,20157,dev.mobile.maestro,0,stop dev.mobile.maestro due to deletePackageX,155196]
adb logcat -d -b system | Select-String lowmemorykiller
(nothing)
adb shell cmd connectivity airplane-mode
disabled
hive-maestro dirs: 0
8477/8478: 0
adb shell dumpsys meminfo | Select-String "Free RAM"
 Free RAM: 1,086,059K (  445,539K cached pss +   295,844K cached kernel +   344,676K free)
(live stream adb.exe pid 46560 stopped; Metro pid 60124 still listening on 8081)
```

No `am_low_memory` line at all during this pass; every app kill is an explicit Maestro stop or clear.

## Verdict per flow

| flow | verdict | evidence |
|---|---|---|
| mfa-enroll | PASS (2/2) | runner OK line both passes; find 47 scroll to `mfa-submit` at 100 % and the tap COMPLETED; hook: email 312/336, OTP 268/292, TOTP 268/292 twice; 0 crash bytes |
| staff-sign-out | PASS (2/2) | `settings-sign-out` tap, `sign-in-email` visible, relaunch shows `sign-in-email` and no `dashboard-workspace` |
| mfa-login | PASS (2/2) | `mfa-enroll-qr` not visible, `mfa-code` visible, scroll + `mfa-submit` tap, `dashboard-workspace` visible; factor revoked and read back zero; hook: email 312/336, OTP 268/292, TOTP 268/292 |
| sign-in | PASS | exit 0, 37 s; hook: email 312/336, OTP 268/292; 0 crash bytes |
| quarantine-recovery | PASS | exit 0, 30 s; `ReactNativeJS` log 19 lines: 16 hook, 2 bootstrap, 1 header; 0 error class names, 0 `Auto refresh tick failed`, 0 `QuarantineRequiredError`, 0 `Uncaught`, 0 unhandled rejections; 0 crash bytes |

Five flows, five PASS (the runner's three twice over); no `DeviceServerDiedException`, no rerun on failure, no restart of anything.

## What the coordinator should take from this run

1. Finds 30/37/47/49 are device-confirmed end to end at 4cb6144: the enrollment runner completed twice in a row (154 s and 157 s), and the exact step that failed at bd2be6c (label tap) and e92c133 (scroll to `mfa-submit`) COMPLETED in both mfa-enroll and mfa-login, with the hook showing the keyboard room applied on those screens (`room=292` under the number pad for the TOTP field, `room=336` under the full keyboard for the email field). The keyboard room is not sign-in-only.
2. Find 46 is device-confirmed: through corrupt-storage, stop, relaunch into quarantine, and scrub, the JavaScript log contained nothing but the hook's lines and the two bootstrap lines. No `Auto refresh tick failed`, no `QuarantineRequiredError` reaching the console, no uncaught error, no unhandled rejection, no `storage_quarantine_entered` (diagnostics are null in the app, so zero was the expectation).
3. Runbook fact: Maestro's Android driver clears logcat at each flow start (the main buffer's earliest entry equalled the flow's launch instant in three separate flows, with no wrap and no `logcat -c` in the repo's scripts). Any post-hoc `adb logcat -d` after the multi-flow runner shows only the clipboard scrub. To capture hook lines through the runner, start `adb logcat -v time -s ReactNativeJS > file` before it and stop it after; that is how the supplementary pass above was captured, and it reproduced the sign-in dump line for line.
4. The memory gate as written (`dumpsys meminfo` Free RAM ≥ 600,000K) never came close to blocking: readings were 1.00 to 1.10 GB throughout while `free -m` kept reporting about 140 to 300 MB. No `lowmemorykiller` line and no OOM kill of the app appeared in any window; every `am_kill` of the app was a Maestro stop or clear. The RAM-headroom question from runs 8 and 9 can be closed on this evidence unless Kody wants the emulator's RAM raised for other reasons.
5. Find 50 nuance: after a docs-only pull, a fresh launch produced a `(1 module)` bundle line and the hook was present. The stale-bundle signal is the missing `installed` line, not the `(1 module)` line by itself; the latter is the normal delta when nothing in the graph changed. Suggested runbook wording: restart Metro when the `installed` line is missing or the Metro log says "Restart the server", and treat `(1 module)` as suspicious only after a pull that touched JavaScript or `metro.config.js`.
6. Second-OTP number pad geometry is now on record too: `height=268 screenY=622` gives `room=292`; the shell handles both keyboard heights without a special case.
