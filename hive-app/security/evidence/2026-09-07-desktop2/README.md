# Desktop 2 evidence — HIVE 2026 design screenshots at 3898ea5, and lanes report 3 at ca96181

Captured 2026-09-06 (local time, Kody's Windows desktop) by desktop session `hive-app-67`, driven by the cloud coordinator's task. Synthetic data only. No `pm clear`, no Metro or emulator restarts.

## Contents

- `lanes-report-3-at-ca96181.md` — the previous desktop session's full 18-flow Maestro report at head ca96181 (15 PASS, 3 FAIL: read-surfaces-denied, accessibility-smoke, quarantine-recovery). Copied verbatim from `$env:TEMP\hive-lanes-report-3.md`; that session could not deliver it to the cloud coordinator.
- `screenshots/` — 27 PNGs of the restyled app at head **3898ea5** (HIVE 2026 design: Brand Kit v3.0 colors, Deep Black header with the honeycomb mark, dark bottom navigation, bundled Manrope fonts served over Metro). Every file is a 50 % downscale (540×1200) of the emulator's 1080×2400 capture, written with System.Drawing, PNG format, names unchanged.

## Environment

- Head: `3898ea5 HIVE 2026 design, slice 3: detail, Activity, Help, Account, sign-in, code, authenticator, workspace chooser; derived icons; find 40` (fast-forwarded from ca96181 in this session).
- Device: Android emulator `emulator-5554`, AVD Pixel_8, API 35 (Android 15, `sdk_gphone16k_x86_64`), dev build `com.myhbcfo.hive.development` (the binary installed by the previous native build; JS and fonts served by the running Metro on port 8081 with `EXPO_PUBLIC_QA_HOOKS=1`).
- Local stack: Mailpit on 127.0.0.1:54324 (HTTP 200 on `/api/v1/info`).
- `npm install --no-audit --no-fund` → "up to date", exit 0; `npm ls expo-font` → expo-font@57.0.3.
- Baseline device settings before capture: `font_scale` = 1.0, `cmd uimode night` = no, airplane mode disabled. All three verified restored to the same values after capture.

## Screenshots

Theme is the system setting (`adb shell cmd uimode night yes|no`); text scale is `adb shell settings put system font_scale 1.0|2.0`.

| File | Theme | Text scale | Screen / state |
|---|---|---|---|
| light-01-home.png | light | 100 % | Home, Harbor Light Bakery LLC (Synthetic), ready |
| light-02-requests.png | light | 100 % | Requests list, ready |
| light-03-request-detail.png | light | 100 % | Request detail ("Bank statement for the closing month (Synthetic)"), ready |
| light-04-activity.png | light | 100 % | Activity list, ready |
| light-05-help.png | light | 100 % | Help, "What HIVE shows" section |
| light-06-account.png | light | 100 % | Account (settings) |
| light-07-home-offline.png | light | 100 % | Home, offline state (`dashboard-offline`) after Refresh in airplane mode |
| light-08-sign-in-session-ended.png | light | 100 % | Sign-in with the "Note: Your session ended. Sign in again to continue." notice, captured with `adb exec-out screencap` right after `.maestro/expired-session.yaml` passed |
| dark-01-home.png … dark-06-account.png | dark | 100 % | Same six screens as light-01…06 |
| dark-07-home-offline.png | dark | 100 % | Home, offline state |
| dark-200-01-home.png … dark-200-06-account.png | dark | 200 % | Same six screens |
| light-200-01-home.png … light-200-06-account.png | light | 200 % | Same six screens |

There is no MFA/authenticator screenshot by rule.

## How they were captured

Ad-hoc Maestro flows (NOT part of the repository; kept in `$env:TEMP\hive-shots\`, run from that directory):

- `tour.yaml`: launchApp → assert "Choose a workspace" → tap "Harbor Light Bakery LLC \(Synthetic\), Client access" → assert `dashboard-workspace` → screenshot 01 → tap `nav-requests` → assert `requests-list` → screenshot 02 → tap "Bank statement for the closing month \(Synthetic\)" (the same selector as `.maestro/requests.yaml`) → assert `request-detail-ready` → screenshot 03 → tap `request-detail-back` → tap `nav-activity` → assert `activity-list` → screenshot 04 → tap `nav-help` → assert `help-section-what-hive-shows` → screenshot 05 → tap `nav-account` → assert `settings-screen` → screenshot 06.
- `tour-rest.yaml`: launchApp → chooser → Bakery → `dashboard-workspace` → the 04/05/06 steps above only. Used at 200 % text, where `tour.yaml` stops at `request-detail-back` (see Observations).
- `offline.yaml`: launchApp → chooser → Bakery → `dashboard-workspace` → `setAirplaneMode: enabled` → tap `dashboard-refresh` → assert `dashboard-offline` → screenshot 07 → `setAirplaneMode: disabled`. (A first version that navigated Account → Home instead of tapping Refresh failed the `dashboard-offline` assertion: returning by nav shows the already-loaded dashboard, and only a fresh read shows the offline state, exactly as `.maestro/offline.yaml` and `.maestro/read-surfaces-offline.yaml` do it. The flow was changed to the repo's Refresh technique and rerun.)

Maestro on this machine writes `takeScreenshot` files under `C:\Users\kodyr\.maestro\tests\<run>\<flow name>\takeScreenshot\`, not the working directory; they were copied from there into `$env:TEMP\hive-shots\`.

Commands, in order (each `maestro test` was `cmd /c "maestro test ... 2>&1" | Tee-Object -FilePath "$env:TEMP\<name>.log"`):

```
git fetch origin claude/hive-fable-5-greenfield-p0cwkq; git status; git pull --ff-only; git log --oneline -1   -> 3898ea5
npm install --no-audit --no-fund; npm ls expo-font
adb devices; adb shell getprop sys.boot_completed; adb shell cmd package list packages com.myhbcfo; adb shell cmd connectivity airplane-mode
adb shell settings get system font_scale; adb shell cmd uimode night          (baseline 1.0 / no)
maestro test .maestro/sign-in.yaml                                              exit 0
maestro test -e SHOT=light tour.yaml                                            exit 0
maestro test -e SHOT=light offline.yaml                                         exit 0 (second version; first version exit 1, see above)
maestro test .maestro/expired-session.yaml                                      run 1 exit 1 (Maestro adb transport died mid-flow), run 2 exit 1 (app already signed out by run 1), then:
maestro test .maestro/sign-in.yaml                                              exit 0
maestro test .maestro/expired-session.yaml                                      run 3 exit 0
cmd /c "adb exec-out screencap -p > %TEMP%\hive-shots\light-08-sign-in-session-ended.png"
adb shell cmd uimode night yes
maestro test .maestro/sign-in.yaml                                              exit 0
maestro test -e SHOT=dark tour.yaml                                             exit 0
maestro test -e SHOT=dark offline.yaml                                          exit 0
adb shell settings put system font_scale 2.0
maestro test .maestro/sign-in.yaml                                              exit 0
maestro test -e SHOT=dark-200 tour.yaml                                         exit 1 at "Tap on id: request-detail-back" (01-03 captured)
maestro test -e SHOT=dark-200 tour-rest.yaml                                    exit 0 (04-06 captured)
adb shell cmd uimode night no
maestro test -e SHOT=light-200 tour.yaml                                        exit 1 at "Tap on id: request-detail-back" (01-03 captured)
maestro test -e SHOT=light-200 tour-rest.yaml                                   exit 0 (04-06 captured)
adb shell settings put system font_scale 1.0; adb shell cmd uimode night no    (verified 1.0 / no; airplane mode disabled)
```

## Observations (read-only; not claims about intent)

1. **200 % text, request detail:** `tapOn: id: request-detail-back` fails in both themes at font_scale 2.0 with "Element not found". The failure screenshot shows the detail content filling the viewport down to the Due row; the "Back to requests" button sits below the fold of the scrollable Screen, and Maestro's tap-by-id does not scroll. The control is reachable by scrolling; the repo's `.maestro/requests.yaml` would meet the same limit at 200 % unless it scrolls first. At 100 % the same step COMPLETED in both themes.
2. **Maestro transport:** one `expired-session.yaml` run died with `io.grpc.StatusRuntimeException: UNAVAILABLE … Command failed (tcp:62615): closed` at the `signed-out-reason` assertion (no FAILED line; exit 1). `adb devices` and `sys.boot_completed` were healthy immediately afterwards and the next runs passed. Same family as the driver start-up timeout noted in lanes report 3.
3. **PowerShell redirection corrupts screencaps:** `adb exec-out screencap -p > file` under PowerShell 5.1 writes a UTF-8 BOM and re-encoded bytes (file began `ef bb bf …`). The `cmd /c` form writes raw bytes (`89 50 4e 47 …`). Only the raw capture is kept.

## Native rebuild after clean prebuild (2026-09-07 local, desktop session `hive-app-42`)

- Head: `8732561` (finds 42 and 43) with this folder's evidence commit rebased on top as `1aa3bee` and pushed 2026-09-06 23:27 (the one permitted history operation; only 77f9e2a replayed, no conflict).
- `npx expo prebuild --platform android --clean`: exit 0 ("Cleared android code", "Created native directory", "Finished prebuild").
- Generated project checks: `android/app/src/main/res/values/colors.xml` has `splashscreen_background` #F3F2EA, `iconBackground` #111310, `activityBackground` #F3F2EA and no F4E4CD. `mipmap-xxxhdpi`: ic_launcher.webp 10171 B, ic_launcher_foreground.webp 15711 B (the 803-byte placeholder is gone), ic_launcher_monochrome.webp 9172 B, ic_launcher_round.webp 12369 B. `android/app/src/debug/AndroidManifest.xml` carries `android:networkSecurityConfig="@xml/hive_debug_network_security_config"`.
- `npx expo run:android`: BUILD SUCCESSFUL in 1m 11s, 338 actionable tasks (168 executed, 142 from cache, 28 up-to-date); APK installed (`lastUpdateTime=2026-09-06 23:29:16`, versionName 0.1.0) and launched; exit 0.
- `screenshots/launcher-icon-clean.png`: 50 % downscale (540x1200, System.Drawing, PNG) of `adb exec-out screencap` of the app drawer. The HIVE Dev icon shows the gold honeycomb mark (six outlined hexagons around a filled centre hexagon) on a dark near-black circle; the other icons are the stock emulator apps. The rebuilt app's own splash is Warm Paper with the same mark on a Soft Black circle.
- Sign-in on the rebuilt binary: `.maestro/sign-in.yaml` exit 1 on all three attempts (23:30, 23:36, 00:17), each at "Assert that id: sign-in-email is visible" after the flow's 30 s bounded wait. The cause is on the host, not in the app: the Metro process (pid 40480, the `expo run:android` started at 14:52 that has served every lane today) has run one thread at 100 % CPU since the clean prebuild replaced `android/`, with zero file I/O and no transform-cache writes (last cache write 22:43); its `/status` endpoint answered in 15 to 33 s at every sample from 23:34 to 00:16, and the app's bundle arrived only after the bound (first launch: "Running main" at 23:36:07, six minutes after launch; later launches: the `isMetroRunning` probe alone took 27 s). Outside Maestro the rebuilt binary did boot and reach sign-in: `uiautomator dump` listed `sign-in-screen`, `brand-header`, `brand-mark`, `brand-wordmark`, `sign-in-email`, `sign-in-submit` at 23:36 and 23:38. Metro was not restarted (outside this session's authority).
- The three flows owed at this head, one attempt each as instructed; all exit 1 at their first launch wait for the same Metro cause; airplane mode confirmed disabled after each:
  - `npm run maestro:denied` (`hive-denied4.log`): FAILED inside its own `sign-in.yaml` at `sign-in-email`; "membership restored and verified (process exit)", "artifact tree scrubbed". exit 1.
  - `maestro test .maestro/accessibility-smoke.yaml` (`hive-a11y2.log`): `Assert that "HIVE" is visible... FAILED` (the failure screenshot samples #F3F2EA and #111310, the splash). Not an AndroidDriverTimeoutException, so no retry. exit 1.
  - `maestro test .maestro/sign-in.yaml` (`hive-signin-q.log`) exit 1 at `sign-in-email`, then `maestro test .maestro/quarantine-recovery.yaml` (`hive-quarantine2.log`) exit 1 at `Assert that "Choose a workspace" is visible`.
  - Finds 40 to 42 therefore remain unverified on-device at this head; the runs are transport evidence, not app evidence. Unblock: restart Metro (`EXPO_PUBLIC_QA_HOOKS=1`, port 8081) and rerun the three lanes; no rebuild is needed.
- Restoration verified: airplane mode disabled, `font_scale` 1.0, night mode no, no `hive-maestro-*` directories in `%TEMP%`, nothing listening on 8477 or 8478.
