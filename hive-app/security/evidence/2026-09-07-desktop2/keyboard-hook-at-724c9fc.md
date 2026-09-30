# HIVE device lane — keyboard geometry observed on the sign-in screen at head 724c9fc, find 49 third iteration (2026-09-07, Kody's Windows desktop, emulator-5554 Pixel_8 API 35)

Operator: local desktop session driven by the cloud coordinator's task. Synthetic data only. No `pm clear`, no rebuild/prebuild, no emulator restart. One Metro restart, exactly as the runbook says, because the first launch showed no `installed` line (details in STEP 3). Runner OK/FAIL lines, adb/git output lines, and the hook's own marker lines only (they carry numbers only); no token, secret, TOTP key, QR, or clipboard content recorded; no screenshot or hierarchy dump was taken while an authenticator screen was showing (none appeared in this run).

**Verdict in one line: at head 724c9fc, with the hook in the served bundle, `event=keyboardDidShow` DID appear on both taps, with `height=312` and `screenY=578` (dp; window 411x914), and the `room` line that followed each one carried a nonzero `room=336`; the shell's ScrollView shrank from `[0,295][1080,2400]` to `[0,295][1080,1518]` while the IME frame was `[0,1517][1080,2400]` (883 px), and `keyboardDidHide` restored `room=0` both times. The hook's `installed` line was ABSENT on the first launch because the running Metro had not reloaded the changed `metro.config.js` and served a 1-module delta bundle; after the runbook restart (full 1690-module bundle) every expected line appeared. STEP 4 (find 46) was NOT RUN: `free -m` showed 140 MB free after STEP 3, under the task's 300 MB gate.**

## Git head

```
git fetch origin claude/hive-fable-5-greenfield-p0cwkq
   b6cc9ea..724c9fc  claude/hive-fable-5-greenfield-p0cwkq -> origin/claude/hive-fable-5-greenfield-p0cwkq
git status
On branch claude/hive-fable-5-greenfield-p0cwkq
Your branch is behind 'origin/claude/hive-fable-5-greenfield-p0cwkq' by 2 commits, and can be fast-forwarded.
nothing to commit, working tree clean
git pull --ff-only
Updating b6cc9ea..724c9fc
Fast-forward
 hive-app/app/_layout.tsx                           |  17 ++
 hive-app/docs/auth-state-machine.md                |  18 ++
 .../2026-08-22-milestone1-read-only-dashboard.md   | 151 ++++++++++++++
 hive-app/metro.config.js                           |   4 +-
 hive-app/scripts/lib/secret-patterns.mjs           |   7 +-
 hive-app/src/app-runtime.ts                        |   8 +-
 hive-app/src/auth/__tests__/controller.test.ts     | 113 ++++++++++-
 hive-app/src/auth/client-lifecycle.ts              |  22 ++-
 hive-app/src/auth/controller.ts                    |  38 +++-
 .../src/data/supabase/__tests__/bridge.test.ts     | 107 ++++++++++
 .../supabase/__tests__/quarantine-bridge.test.ts   | 168 ++++++++++++++++
 hive-app/src/data/supabase/client.ts               | 216 +++++++++++++++------
 .../src/dev/__tests__/qa-keyboard-hook.test.ts     | 120 ++++++++++++
 hive-app/src/dev/qa-keyboard-hook.stub.ts          |  13 ++
 hive-app/src/dev/qa-keyboard-hook.ts               | 127 ++++++++++++
 hive-app/src/ui/__tests__/screen.test.tsx          |  69 +++++++
 hive-app/src/ui/primitives/Screen.tsx              |  13 ++
 hive-app/src/ui/primitives/keyboard-room-probe.ts  |  29 +++
 hive-app/tests/live/journeys.ts                    |   6 +-
 hive-app/tests/scripts/bundle-inspect.test.mjs     |   7 +-
 20 files changed, 1175 insertions(+), 78 deletions(-)
git log --oneline -1
724c9fc Find 49, third iteration: observe before deriving again — a production-inert keyboard-room seam in the shell and a QA-build hook that logs the keyboard's reported geometry; run 8 recorded
```

Head 724c9fc, subject beginning "Find 49, third iteration", as expected.

```
Select-String -Path src\dev\qa-keyboard-hook.ts -Pattern HIVE_QA_KEYBOARD_HOOK
qa-keyboard-hook.ts:1: /** HIVE_QA_KEYBOARD_HOOK — development-only keyboard geometry log (find 49,
qa-keyboard-hook.ts:34: export const QA_KEYBOARD_HOOK_MARKER = 'HIVE_QA_KEYBOARD_HOOK';
Select-String -Path metro.config.js -Pattern qa-keyboard-hook
metro.config.js:22: const QA_HOOK_STUBS = ['qa-corrupt-storage', 'qa-expire-session', 'qa-keyboard-hook'];
```

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
::                8081         21012
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8081/status   (body decoded with [Text.Encoding]::ASCII.GetString)
status HTTP 200 body=packager-status:running ms=25
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:54324/api/v1/info
mailpit HTTP 200
Get-ChildItem $env:TEMP -Directory -Filter 'hive-maestro-*'
(nothing; count 0)
Get-NetTCPConnection -State Listen | Where-Object { $_.LocalPort -in 8477,8478 }
(nothing; count 0)
adb shell free -m
		total        used        free      shared     buffers
Mem:             2472        2281         190          19          12
-/+ buffers/cache:           2269         202
Swap:            1854         299        1555
```

Metro (pid 21012, the process started by the previous desktop session with `EXPO_PUBLIC_QA_HOOKS=1`) answered `/status` in 25 ms. Mailpit 200. No stale artifact tree, no helper port listening. Free RAM 190 MB before anything ran (the same emulator that killed Maestro's driver in run 8).

## STEP 3 — the observation

### 3a/3b, first launch (Metro NOT restarted)

```
adb logcat -c                                                    exit 0
adb shell am force-stop com.myhbcfo.hive.development             exit 0
adb shell monkey -p com.myhbcfo.hive.development -c android.intent.category.LAUNCHER 1
Events injected: 1                                               exit 0, host clock 02:25:40.831
(wait 45 s)
adb logcat -d -s ReactNativeJS | Select-String HIVE_QA_KEYBOARD_HOOK
(0 lines)
```

Cross-checks at that moment: the app process was alive (pidof returned a pid), the uiautomator dump contained `sign-in-email` and `brand-wordmark` (chooser and Home absent), and `adb logcat -d -s ReactNativeJS` held 2 lines in total (the bundle's "Running main" line and the buffer header; no hook line). Metro's own log (`%TEMP%\hive-metro.log`, the previous session's process) ended with:

```
Android Bundled 33ms node_modules\expo-router\entry.js (1 module)
Detected a change in metro.config.js. Restart the server to see the new results.
Android Bundled 32ms node_modules\expo-router\entry.js (1 module)
```

The bundle served to that launch (log last written 02:25:42) was a 1-module delta, not a rebuild of the 20 changed files; and Metro had flagged the `metro.config.js` change as needing a restart. So there was NO `installed` line: the served bundle did not carry the hook. Per the task, Metro was restarted once, exactly as the runbook says.

### Metro restart (needed: YES)

```
Stop-Process -Id 21012 (node)                                    8081 listeners after stop: 0
(previous log copied to %TEMP%\hive-metro-prev.log)
Start-Process cmd.exe '/c set CI=1&& set EXPO_PUBLIC_QA_HOOKS=1&& npx expo start --port 8081 > "%TEMP%\hive-metro.log" 2>&1' -WorkingDirectory C:\dev\Lighthouse\hive-app -WindowStyle Hidden
metro start issued at 02:27:25.402
(poll /status every 3 s, decoded body)
status ready at 02:27:50.863 after 4 tries: HTTP 200 body=packager-status:running ms=2119
8081 listener pid: 60124
```

### 3a/3b, second launch (after the restart)

```
adb logcat -c                                                    exit 0
adb shell am force-stop com.myhbcfo.hive.development             exit 0
adb shell monkey -p com.myhbcfo.hive.development -c android.intent.category.LAUNCHER 1
Events injected: 1                                               exit 0, host clock 02:27:58.422
Metro: Android Bundled 3680ms node_modules\expo-router\entry.js (1690 modules)
adb logcat -d -s ReactNativeJS | Select-String HIVE_QA_KEYBOARD_HOOK   (read at host 02:28:16)
09-07 02:28:05.760 11152 11192 I ReactNativeJS: HIVE_QA_KEYBOARD_HOOK installed platform=android window=411x914 screen=411x914
09-07 02:28:05.775 11152 11192 I ReactNativeJS: HIVE_QA_KEYBOARD_HOOK room platform=android windowHeight=914 containerBottom=914 keyboardHeight=0 bottomInset=24 room=0
09-07 02:28:05.980 11152 11192 I ReactNativeJS: HIVE_QA_KEYBOARD_HOOK room platform=android windowHeight=914 containerBottom=null keyboardHeight=0 bottomInset=24 room=0
09-07 02:28:06.016 11152 11192 I ReactNativeJS: HIVE_QA_KEYBOARD_HOOK room platform=android windowHeight=914 containerBottom=914 keyboardHeight=0 bottomInset=24 room=0
```

The `installed` line and three `room` lines (all `keyboardHeight=0`, `room=0`; one with `containerBottom=null` between two with `containerBottom=914`) appeared 7-8 s after the launch. Clock note: logcat timestamps are the emulator's clock, which ran about 1.9 s behind the host clock quoted for the adb commands throughout this run (tap at host 02:28:42.042 -> event at device 02:28:41.482; keyevent at host 02:29:25.088 -> event at device 02:29:23.198).

### 3c/3d — sign-in screen confirmed; bounds before the keyboard

```
cmd /c "adb exec-out uiautomator dump /dev/tty" > %TEMP%\hive-kb3-before.xml
has sign-in-email: True; has Choose a workspace: False; has dashboard-workspace: False
```

The app came up on the sign-in screen (no scrub lane needed). Nodes (window 1080x2400 px, density 2.625):

```
ScrollView (scrollable=false)   bounds=[0,0][1080,2400]
sign-in-screen                  bounds=[0,0][1080,2400]
screen-keyboard-room            bounds=[0,295][1080,2400]      <- the wrapper is exposed in the dump at this head (it was not at 4c6c625)
ScrollView (scrollable=true)    bounds=[0,295][1080,2400]      <- the shell's scroll view under the 295 px header band
sign-in-email                   bounds=[63,742][1017,889]
sign-in-submit                  bounds=[63,952][1017,1089]
```

### 3e — open the keyboard

```
adb logcat -c                                                    exit 0
adb shell input tap 540 815                                      exit 0, host clock 02:28:42.042
(wait 3 s)
adb shell dumpsys input_method | Select-String mInputShown
mInputShown=true
adb shell dumpsys window | Select-String "type=ime|mInsetsHint"
InsetsSource id=3 type=ime frame=[0,1517][1080,2400] visibleFrame=[0,1517][1080,2400] visible=true flags= sideHint=BOTTOM boundingRects=null
InsetsSourceControl: {3 mType=ime mSurfacePosition=Point(0, 74) mInsetsHint=Insets{left=0, top=0, right=0, bottom=883}}
mInsetsHint=Insets{left=0, top=0, right=0, bottom=883}
(also present, for reference: navigationBars mInsetsHint bottom=63; statusBars mInsetsHint top=74)
```

Same keyboard as run 8: top y=1517, height 883 px (336.4 dp).

### 3f — hook lines with the keyboard up (every line, verbatim, in order), then the dump

```
adb logcat -d -s ReactNativeJS | Select-String HIVE_QA_KEYBOARD_HOOK   (read at host 02:28:52.884)
09-07 02:28:41.482 11152 11192 I ReactNativeJS: HIVE_QA_KEYBOARD_HOOK event=keyboardDidShow platform=android height=312 screenY=578 screenX=0 width=411 window=411x914 screen=411x914
09-07 02:28:41.490 11152 11192 I ReactNativeJS: HIVE_QA_KEYBOARD_HOOK room platform=android windowHeight=914 containerBottom=914 keyboardHeight=312 bottomInset=24 room=336
```

```
cmd /c "adb exec-out uiautomator dump /dev/tty" > %TEMP%\hive-kb3-after.xml   (host 02:28:59.180)
ScrollView (scrollable=false)   bounds=[0,0][1080,2400]
sign-in-screen                  bounds=[0,0][1080,2400]
screen-keyboard-room            bounds=[0,295][1080,2400]      <- unchanged (the wrapper pads; it does not shrink)
ScrollView (scrollable=true)    bounds=[0,295][1080,1518]      <- CHANGED: bottom 2400 -> 1518 (336 dp x 2.625 = 882 px; IME top is 1517)
sign-in-email                   bounds=[63,742][1017,889]       <- unchanged (above the keyboard already)
sign-in-submit                  bounds=[63,952][1017,1089]      <- unchanged (above the keyboard already)
```

### 3g — later lines, then dismiss

```
(15 s after the first read)
adb logcat -d -s ReactNativeJS | Select-String HIVE_QA_KEYBOARD_HOOK   (read at host 02:29:24.958)
(the same 2 lines as above; no later lines)
adb shell input keyevent 111                                     exit 0, host clock 02:29:25.088
(wait 3 s)
adb shell dumpsys input_method | Select-String mInputShown
mInputShown=false
adb logcat -d -s ReactNativeJS | Select-String HIVE_QA_KEYBOARD_HOOK
09-07 02:28:41.482 11152 11192 I ReactNativeJS: HIVE_QA_KEYBOARD_HOOK event=keyboardDidShow platform=android height=312 screenY=578 screenX=0 width=411 window=411x914 screen=411x914
09-07 02:28:41.490 11152 11192 I ReactNativeJS: HIVE_QA_KEYBOARD_HOOK room platform=android windowHeight=914 containerBottom=914 keyboardHeight=312 bottomInset=24 room=336
09-07 02:29:23.198 11152 11192 I ReactNativeJS: HIVE_QA_KEYBOARD_HOOK event=keyboardDidHide platform=android height=0 screenY=914 screenX=0 width=411 window=411x914 screen=411x914
09-07 02:29:23.204 11152 11192 I ReactNativeJS: HIVE_QA_KEYBOARD_HOOK room platform=android windowHeight=914 containerBottom=914 keyboardHeight=0 bottomInset=24 room=0
```

### 3h — second tap, dump, dismiss

```
adb shell input tap 540 815                                      exit 0, host clock 02:29:43.177
(wait 3 s)
adb shell dumpsys input_method | Select-String mInputShown
mInputShown=true
adb logcat -d -s ReactNativeJS | Select-String HIVE_QA_KEYBOARD_HOOK   (lines 5-6 are new)
09-07 02:28:41.482 11152 11192 I ReactNativeJS: HIVE_QA_KEYBOARD_HOOK event=keyboardDidShow platform=android height=312 screenY=578 screenX=0 width=411 window=411x914 screen=411x914
09-07 02:28:41.490 11152 11192 I ReactNativeJS: HIVE_QA_KEYBOARD_HOOK room platform=android windowHeight=914 containerBottom=914 keyboardHeight=312 bottomInset=24 room=336
09-07 02:29:23.198 11152 11192 I ReactNativeJS: HIVE_QA_KEYBOARD_HOOK event=keyboardDidHide platform=android height=0 screenY=914 screenX=0 width=411 window=411x914 screen=411x914
09-07 02:29:23.204 11152 11192 I ReactNativeJS: HIVE_QA_KEYBOARD_HOOK room platform=android windowHeight=914 containerBottom=914 keyboardHeight=0 bottomInset=24 room=0
09-07 02:29:41.681 11152 11192 I ReactNativeJS: HIVE_QA_KEYBOARD_HOOK event=keyboardDidShow platform=android height=312 screenY=578 screenX=0 width=411 window=411x914 screen=411x914
09-07 02:29:41.689 11152 11192 I ReactNativeJS: HIVE_QA_KEYBOARD_HOOK room platform=android windowHeight=914 containerBottom=914 keyboardHeight=312 bottomInset=24 room=336
cmd /c "adb exec-out uiautomator dump /dev/tty" > %TEMP%\hive-kb3-after2.xml   (host 02:29:48.367)
ScrollView (scrollable=false)   bounds=[0,0][1080,2400]
screen-keyboard-room            bounds=[0,295][1080,2400]
ScrollView (scrollable=true)    bounds=[0,295][1080,1518]      <- shrunk again
sign-in-email                   bounds=[63,742][1017,889]
sign-in-submit                  bounds=[63,952][1017,1089]
adb shell input keyevent 111                                     exit 0, host clock 02:29:48.423
(wait 3 s)
adb shell dumpsys input_method | Select-String mInputShown
mInputShown=false
adb logcat -d -s ReactNativeJS | Select-String HIVE_QA_KEYBOARD_HOOK   (lines 7-8 are new)
09-07 02:29:46.547 11152 11192 I ReactNativeJS: HIVE_QA_KEYBOARD_HOOK event=keyboardDidHide platform=android height=0 screenY=914 screenX=0 width=411 window=411x914 screen=411x914
09-07 02:29:46.563 11152 11192 I ReactNativeJS: HIVE_QA_KEYBOARD_HOOK room platform=android windowHeight=914 containerBottom=914 keyboardHeight=0 bottomInset=24 room=0
```

No `keyboardWillShow` or `keyboardWillHide` line appeared at any point (Android does not emit them); 8 event/room lines in total after the launch's 4, all from the same JS thread (pid 11152, tid 11192). Whole `ReactNativeJS` buffer since the 3e clear: 9 lines (the 8 hook lines plus the buffer header).

### Memory after STEP 3

```
adb shell free -m
		total        used        free      shared     buffers
Mem:             2472        2332         140          23          13
-/+ buffers/cache:           2318         153
Swap:            1854         320        1534
adb shell dumpsys meminfo | Select-String "Total RAM|Free RAM|Used RAM"   (about a minute later, app still in the foreground)
Total RAM: 2,531,944K (status normal)
Free RAM: 1,015,792K (  234,500K cached pss +   657,264K cached kernel +   124,028K free)
Used RAM: 1,669,248K (1,433,924K used pss +   235,324K kernel)
```

## STEP 4 — find 46 device proof: NOT RUN

`free -m` showed 140 MB free (153 MB net of buffers/cache) after STEP 3, under the task's 300 MB gate, so neither `sign-in.yaml` nor `quarantine-recovery.yaml` was started. No Maestro process ran in this session. The `dumpsys meminfo` line above shows the kernel's own accounting counts about 1 GB as reclaimable; that is recorded for the coordinator's decision, not used to override the gate.

Closing state (no lane ran, checked anyway):

```
adb shell cmd connectivity airplane-mode
disabled
Get-ChildItem $env:TEMP -Directory -Filter 'hive-maestro-*'
(nothing; count 0)
Get-NetTCPConnection -State Listen | Where-Object { $_.LocalPort -in 8477,8478 }
(nothing; count 0)
adb logcat -d -b crash
0 bytes
```

## Verdict per flow

| flow | verdict | evidence |
|---|---|---|
| keyboard hook observation (STEP 3) | OBSERVED | `installed` line present after the Metro restart; `keyboardDidShow height=312 screenY=578` on both taps; `room=336` after each show, `room=0` after each hide; ScrollView bottom 2400 -> 1518 px with the keyboard up, both times |
| sign-in | NOT RUN | STEP 4 skipped: 140 MB free after STEP 3 (< 300 MB gate) |
| quarantine-recovery | NOT RUN | STEP 4 skipped: same gate |

## What the coordinator should take from this run

1. The `keyboardDidShow` event does reach JavaScript on this edge-to-edge window, and with sensible numbers: `height=312` dp (883 px / 2.625 = 336.4 dp; 312 = 336 minus the 24 dp `bottomInset`, i.e. the navigation bar's 63 px), `screenY=578` (914 - 336). The shell's computation at this head turns that into `room=336`, and the ScrollView measurably shrinks to the IME's top (1518 vs 1517 px). Both show/hide cycles behaved identically. `containerBottom` was `914` on every line except one transient `null` during the launch.
2. Run 8's "zero room" at 4c6c625 was measured against a bundle served by a Metro that, at least by today, had stopped rebuilding changed files: after the pull it served a 1-module delta and printed "Detected a change in metro.config.js. Restart the server". Whether run 8's bundle actually contained the second iteration cannot be told from here; the evidence from run 8 says the ScrollView did not shrink, and the evidence from this run says it does once a fresh Metro serves the head. The coordinator should weigh the possibility that the second iteration was never on the device before deciding what in the third iteration made the difference.
3. Note for the runbook: whenever a pull touches `metro.config.js`, restart Metro before any observation, and treat a "(1 module)" bundle line right after a multi-file pull as a stale bundle. Metro itself says so in its log.
4. `screen-keyboard-room` is now visible in the uiautomator dump (it was not at 4c6c625), which gives Maestro and the desktop a direct observable for the wrapper; its own bounds do not change (it pads), the ScrollView inside it does.
5. Find 46's device proof is still outstanding: the emulator had 140 MB free after STEP 3 and the task's gate said skip. The RAM headroom question from run 8 is unchanged and remains Kody's call.
