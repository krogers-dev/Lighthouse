# HIVE

A client clarity and controlled-workflow app for Honeybee Accounting
clients and staff. What HIVE is and is not is defined in
[PRODUCT.md](PRODUCT.md); the boundaries it must never cross are in
[SECURITY.md](SECURITY.md); the permanent build instructions are in
[CLAUDE.md](CLAUDE.md).

**Everything in this repository runs on synthetic data.** Every identity is
an `example.invalid` address and every label is marked `(Synthetic)`.
Production data, integrations, signing, submission, and release are HOLD.

## Where the work stands

| Milestone                      | State                                                                       |
| ------------------------------ | --------------------------------------------------------------------------- |
| 0 — Identity and isolation     | Implemented; **RETURN** — corrective work reviewed, device evidence pending |
| 1 — Read-only client dashboard | **In progress** — Requests, Activity, Help, and navigation are built        |
| 2+                             | Not started                                                                 |

### What you can see today

Sign in with a synthetic account, pick a workspace, and move between the
five destinations: **Home**, **Requests**, **Activity**, **Help**,
**Account**. Requests and Activity read live from the local Supabase
stack, scoped to the selected workspace.

Milestone 1 is **read-only**. There is no respond, upload, or edit control
anywhere in the binary — absent, not disabled or hidden.

The look is the HIVE 2026 design (Honeybee Brand Kit v3.0, the approved
honeycomb mark, bundled Manrope): a Deep Black header and navigation in
both themes, Warm Paper content by day and Soft Black by night. The system
is documented in [DESIGN.md](DESIGN.md); the handoff it came from, byte for
byte, is under `docs/design/`.

## Prerequisites

The toolchain is pinned, and `npm run verify:toolchain` enforces it.

| Tool           | Version    | Notes                                           |
| -------------- | ---------- | ----------------------------------------------- |
| Node           | 22.23.2    | Exact; `devEngines` refuses anything else       |
| npm            | 10.9.8     | One lockfile, exact pins                        |
| Docker         | any recent | Runs the local Supabase stack                   |
| Xcode          | current    | iOS development build — **macOS only**          |
| Android Studio | current    | Android development build — macOS/Windows/Linux |

### The iOS lane

Nobody on this project has a Mac yet, and Xcode runs only on macOS, so
the iOS lane splits into three tiers that need different things and
prove different things. Each is independent of the others.

| Tier                                                    | Needs                                                                                                                 | Proves                                                                                                     |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 1. Compile proof: an EAS simulator build                | An Expo account and EAS terms (Kody's), nothing from Apple, no Mac. Uploads the project (synthetic) to Expo's servers | The iOS target compiles at this head. The artifact runs only on a macOS Simulator                          |
| 2. The app running: simulator, Maestro flows, VoiceOver | A Mac with Xcode (any Apple Silicon Mac, a Mac mini included); no Apple Developer account, no signing                 | Every flow and both appearances on iOS; VoiceOver; the launch screen; the keyboard room under iOS's events |
| 3. A physical iPhone, later TestFlight                  | Apple Developer Program membership (Kody's purchase) and signing, which is HOLD until Kody authorizes it exactly      | Real hardware; the internal-testing track before any store binary                                          |

Tier 1 is configured. `eas.json` carries one profile, `ios-simulator`,
and `npm run eas:guard` holds the lane to that authorization: one
profile, simulator-only, no submit block, no signing or Apple-account
keys, and a `.easignore` that still covers every `.gitignore` entry (the
check that stops `.env.local` from being uploaded). To run it, once the
account exists:

```bash
npx eas-cli build --platform ios --profile ios-simulator
```

The build carries no Supabase configuration (`.env.local` is not
uploaded) and would reach the configuration-fatal screen on launch by
design. It answers "does it compile", not "does it work".

What is verified without a Mac, at every head that touches native
configuration: `npx expo prebuild --platform ios --no-install` succeeds,
emitting bundle identifier `com.myhbcfo.hive.development` at deployment
target 16.4, `NSAllowsArbitraryLoads=false`, the `hivedev` URL scheme,
`UIUserInterfaceStyle=Automatic`, all four orientations on iPhone and
iPad, an opaque 1024-point app icon (the App Store rule; the icon script
composes it over Soft Black on purpose), and a launch screen that names
the `SplashScreenBackground` colour set (Warm Paper by day, Soft Black by
night). That last one is the work of
`plugins/with-ios-imageless-splash.js`: expo-splash-screen's imageless
path leaves the storyboard referencing a removed image view and keeps the
system white or black background, so the plugin runs after it and
repairs exactly that (find 51; `tests/scripts/ios-imageless-splash.test.mjs`
holds it against the generated storyboard). Like its Android twin it
throws when a splash image is configured, so it retires loudly.

#### Tier 2 on a Mac, end to end

```bash
npm run preflight:device                 # Xcode, an iOS runtime, Docker, Maestro
npm ci
node scripts/local-supabase.mjs up       # the simulator shares the host loopback: 127.0.0.1 is right
node scripts/local-supabase.mjs seed
CI=1 EXPO_PUBLIC_QA_HOOKS=1 npx expo run:ios   # development build onto the booted simulator; prebuild and pod install run for you
```

Then the flows, exactly as on Android (`maestro test .maestro/<flow>.yaml`,
`npm run maestro:enroll`, `npm run maestro:denied`,
`npm run maestro:confinement`); Maestro drives the booted simulator. Read
before the first run:

- `offline.yaml` is Android-only (`setAirplaneMode` has no iOS driver);
  the iOS offline check is manual: Simulator has no airplane mode, so
  stop the local stack instead and watch the offline state.
- `reinstall.yaml` on iOS is manual, as its header says: sign in,
  uninstall, reinstall, and confirm the Keychain remnant is purged before
  auth starts (the install marker's whole purpose).
- The QA deep links work through Maestro's `openLink`; by hand they are
  `xcrun simctl openurl booted 'hivedev:///?qa=corrupt-storage'`.
- The keyboard room (find 49) uses iOS's `keyboardWillShow` and subtracts
  no inset (the iOS keyboard height already includes the home-indicator
  area). The QA build's `HIVE_QA_KEYBOARD_HOOK` lines appear in Metro's
  terminal on iOS; the first run should record them for the enrollment
  screen the way run 9 did on Android.
- After `pod install`, confirm `ios/HIVEDev/PrivacyInfo.xcprivacy` exists:
  Expo aggregates the modules' privacy manifests into it at that step.
  The app's own code uses no required-reason API directly.

Release-readiness items that are not this lane's to decide, recorded so
they are not rediscovered: `ITSAppUsesNonExemptEncryption` is unset (the
export-compliance declaration is Kody's, made in App Store Connect or in
`ios.infoPlist`); the generated Info.plist carries Expo's
`NSAllowsLocalNetworking=true` (development convenience, to be dropped
for a release build); the `NSFaceIDUsageDescription` string is
expo-secure-store's template text and the app never requests biometric
gating.

### The Android lane, end to end

> After any change to `app.json`, `assets/images`, or `plugins/`, regenerate
> the native project before building: `npx expo prebuild --platform android
--clean`, then `npx expo run:android`. A plain `expo run:android` reuses the
> existing gitignored `android/` directory, so icon, splash, and color changes
> are silently NOT applied (desktop 2, 2026-09-06). Then restart Metro: a
> clean prebuild while Metro is running leaves that Metro stalled (one
> thread pinned, `/status` taking 15–30 s, bundles arriving minutes after
> launch), and every flow then fails at its first launch wait (find 44).
> Restart Metro after any pull that touches `metro.config.js`, or when its
> log says "Restart the server": the running Metro can stop rebuilding
> changed files while still serving, and two device runs then measured a
> fix that was not on the device (find 50, desktop 2, 2026-09-07). The
> reliable staleness signal in a QA build is the missing
> `HIVE_QA_KEYBOARD_HOOK installed` line in `adb logcat -s ReactNativeJS`
> after a cold start; a `(1 module)` bundle line is the normal delta when
> nothing in the graph changed and is suspicious only right after a pull
> that touched JavaScript or `metro.config.js`. A fresh Metro reports the
> full module count (about 1690) on the next cold start.
>
> Maestro's Android driver clears logcat at every flow start, so after the
> multi-flow enrollment runner `adb logcat -d` holds only its last flow.
> To read the app's log through a runner, start
> `adb logcat -v time -s ReactNativeJS > file` before it and stop it after
> (desktop 2, run 10).

Everything below runs on Windows, macOS, or Linux. This is the lane that
closes A3 (black-box e2e) and the Android half of A5 (Maestro flows).

```bash
npm run preflight:device                                # what is missing on this machine
npm ci
node scripts/local-supabase.mjs up --android-emulator   # stack + .env.local: real local key, 10.0.2.2 origin
node scripts/local-supabase.mjs seed
npx expo run:android                                    # development build, not Expo Go
```

**`--android-emulator` is not optional on an emulator.** Inside one,
`127.0.0.1` is the emulator itself; the host's loopback is `10.0.2.2`.
Without the flag the app is pointed at a stack that is not there, and the
failure looks like the backend being down rather than like an address
being wrong. Both origins are approved for development in
`security/approved-config.json` and name the same stack — the flag
selects the manifest's `10.0.2.2` entry, it never assembles an origin.
(`env:synthetic` is NOT this lane's tool: its key is deliberately
nonfunctional, so an app configured by it cannot sign in anywhere. The
first Windows bring-up, 2026-08-28, found the previous sequence here
self-defeating — `up` overwrote the emulator origin with loopback.)

On a **physical Android device over adb**, neither address works — the
phone is not the host. Use `adb reverse tcp:54321 tcp:54321` with the
plain `node scripts/local-supabase.mjs up` configuration, so the
`127.0.0.1` it writes is forwarded from the device to the host.

Then the flows, once Maestro is installed:

```bash
npm run maestro:validate                       # structural, no device needed
maestro test .maestro/sign-in.yaml             # and the rest
```

#### What the Android build does to cleartext

The Expo/React Native template ships a debug manifest that sets
`android:usesCleartextTraffic="true"` — plaintext HTTP to **every** host,
in debug builds. SECURITY.md requires Android cleartext denial to be
preserved, so `plugins/with-android-debug-loopback.js` replaces that
blanket permission with a network security config that denies cleartext
by default and excepts only `10.0.2.2`, `127.0.0.1`, and `localhost`.

It applies to the `debug` and `debugOptimized` source sets only. Gradle
build types do not inherit source sets, which is why both are named; a
**release** build is untouched and carries no cleartext exception of any
kind. `npm run config:check` fails if the plugin stops being registered.

### The web target does not run the app

`expo export` produces a web bundle, and it is useful for inspection, but
the app deliberately will not run there:

- a **production-variant** export refuses to start at all, because the
  loopback URL is not allowed outside a development build (you get the
  configuration-fatal screen);
- a **development-variant** export reaches storage quarantine, because
  `expo-secure-store` has no web implementation, so the session store
  fails its verification and the app refuses to show protected UI.

Both are the designed fail-closed behaviors, and both are confirmed by
rendering the export in a browser. Web is an export and inspection target
only; iOS and Android are the product.

## Checks

```bash
npm run preflight:device    # device-lane tooling on THIS machine
npm run eas:guard           # the EAS lane is still simulator-only
npm run verify:toolchain    # pinned versions
npm run lint                # eslint, zero warnings
npm run format:check        # prettier
npm run typecheck           # strict TypeScript
npm test                    # jest: unit, component, contract
npm run test:scripts        # node:test: the gates and harnesses themselves
npm run maestro:validate    # every device flow, parsed and schema-checked
npm run config:check        # profile configuration
npm run secrets:scan        # tracked files AND full Git history
npm run audit:gate          # dependency advisories
npm run db:types:check      # committed types match the schema
```

Database tests need the local harness:

```bash
node scripts/fetch-e2e-binaries.mjs                                 # once per machine: pinned stack binaries
node scripts/db-local.mjs reset && node scripts/db-local.mjs test   # pgTAP
node scripts/local-supabase.mjs e2e                                 # black-box auth, needs Docker
node scripts/e2e-binary-stack.mjs run                               # same harness, no Docker (Linux/macOS)
node scripts/e2e-binary-stack.mjs bridge                            # the APP'S OWN composition against the live stack
```

The binary-stack lane runs the identical black-box harness against real
GoTrue/PostgREST/Mailpit processes on loopback (sha256-pinned, fetched
into the gitignored `.cache/`), for machines where Docker images cannot
be pulled. Its evidence is labeled "binary stack" — the Docker lane is
still the one that exercises the full Supabase CLI composition.

Root-sandbox note: the stack runs PostgreSQL as the `hivepg` system
user, so the checkout's ancestor directories must be traversable by it
(`o+x`); a clone under a `0700` home works only after opening those
traversal bits.

`bridge` goes one layer deeper: it drives the app's OWN shipped
composition — the real `AuthController`, the real supabase-js bundle,
the real scoped repositories from `src/app-runtime.ts`, with only the
two native backends (Keychain, document directory) swapped for named
in-memory synthetics — through full journeys against that stack: OTP
sign-in from a real email, workspace choice, all three read surfaces,
cross-scope denial, staff TOTP to AAL2, verified sign-out, and an
identity switch with no scope bleed. It is the closest thing to running
the app that exists without a device.

### Exit codes are part of the contract

`0` pass · `1` findings · `2` engine failure · `3` explicit HOLD.

`secrets:scan` and `audit:gate` currently exit **3**. That is correct and
expected: both have exceptions that are recorded and `proposed` but not
ratified, and a pending approval is never treated as an approval. See
[security/APPROVALS.md](security/APPROVALS.md) for what clearing them
requires.

## Layout

```
app/            Expo Router routes — thin; one screen component each
src/auth/       Auth state machine, lifecycle controller, secure storage
src/data/       Supabase client and scope-bound repositories
src/features/   Screens and views, one folder per feature
src/tenancy/    ScopeKey, scoped clearing registry
src/ui/         Primitives, tokens, theme (Brand Kit v2.0)
supabase/       Migrations, RLS policies, seed, pgTAP suites
scripts/        Gates and local harnesses
.maestro/       Device flows
security/       Waivers, exceptions, approved configuration, evidence
docs/plans/     Dated execution records
```

## Conventions worth knowing before you change anything

- **Every protected read is bound to a ScopeKey**, and a late response
  from an abandoned scope or membership must never render. That logic
  lives once, in `src/features/shared/useScopedLoad.ts`.
- **Activity stores no free text.** Rows carry an enumerated event kind, a
  role, and a timestamp; the app owns the wording. Client-facing wording
  lives in `src/features/shared/labels.ts` and can be rewritten without
  touching a screen, a query, or a migration.
- **Server dates are parsed by parts**, never through `Date`, so a date
  the server recorded does not shift with the device's timezone.
- **Screens say what data is "recorded through"**, not "as of": the device
  clock is not server truth.
- Adding a dependency goes through the ADR dependency rule first.
