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

## Prerequisites

The toolchain is pinned, and `npm run verify:toolchain` enforces it.

| Tool           | Version    | Notes                                           |
| -------------- | ---------- | ----------------------------------------------- |
| Node           | 22.23.2    | Exact; `devEngines` refuses anything else       |
| npm            | 10.9.8     | One lockfile, exact pins                        |
| Docker         | any recent | Runs the local Supabase stack                   |
| Xcode          | current    | iOS development build — **macOS only**          |
| Android Studio | current    | Android development build — macOS/Windows/Linux |

### Establishing that iOS compiles, without a Mac

Whether this app builds for iOS at all was an open question — nobody had
ever built it for that platform. `eas.json` configures one profile,
`ios-simulator`, to answer exactly that and nothing else:

```bash
npx eas-cli build --platform ios --profile ios-simulator
```

Read before running it:

- **It needs an Expo account and terms acceptance, and it uploads this
  project to Expo's servers.** Everything here is synthetic so nothing
  sensitive moves, but it is an outward transfer to a third party and a
  decision someone has to make. No account is configured in this
  repository and no build has been run.
- **It needs no Apple Developer account and no signing.** A simulator
  build is unsigned. Signing, submission, and release stay HOLD.
- **The artifact is not a demo.** `.env.local` is not uploaded, so the
  build carries no Supabase configuration and would reach the
  configuration-fatal screen on launch. That is the designed fail-closed
  behavior; the build answers "does it compile", not "does it work".
- **It runs only on a macOS Simulator.** A simulator build cannot be
  installed on Windows, on Linux, or on a physical iPhone.

`npm run eas:guard` holds the lane to that authorization: one profile,
simulator-only, no submit block, no signing or Apple-account keys, and a
`.easignore` that still covers every `.gitignore` entry — the check that
stops `.env.local` from being uploaded. It is part of the gate list above.

The generated iOS project has been verified here: `expo prebuild
--platform ios` succeeds, emits bundle identifier
`com.myhbcfo.hive.development` at deployment target 16.4, and keeps
`NSAllowsArbitraryLoads=false` in the Info.plist. Compiling that project
is what has never been done.

### The Android lane, end to end

Everything below runs on Windows, macOS, or Linux. This is the lane that
closes A3 (black-box e2e) and the Android half of A5 (Maestro flows).

```bash
npm run preflight:device                       # what is missing on this machine
npm ci
npm run env:synthetic -- --android-emulator    # writes the 10.0.2.2 origin
node scripts/local-supabase.mjs up
node scripts/local-supabase.mjs seed
npx expo run:android                           # development build, not Expo Go
```

**`--android-emulator` is not optional on an emulator.** Inside one,
`127.0.0.1` is the emulator itself; the host's loopback is `10.0.2.2`.
Without the flag the app is pointed at a stack that is not there, and the
failure looks like the backend being down rather than like an address
being wrong. Both origins are approved for development in
`security/approved-config.json` and name the same stack.

On a **physical Android device over adb**, neither address works — the
phone is not the host. Use `adb reverse tcp:54321 tcp:54321` and the
plain `npm run env:synthetic` origin, so `127.0.0.1` on the device is
forwarded to the host.

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

### Running iOS still needs a Mac

Xcode runs only on macOS, so running the app on iOS, the iOS simulator,
and the iOS half of the Maestro lane cannot happen on a Windows or Linux
machine at any cost — it is not a missing install, and the EAS lane above
does not change it. Android and the local Supabase stack run on all
three. `preflight:device` reports this as **BLOCKED**
rather than as a finding, because a check that fails forever on something
nobody can install is a check people learn to ignore.

On Windows, note that Docker Desktop wants the WSL2 backend, and the
Android emulator needs WHPX (Windows Features → Windows Hypervisor
Platform) — an emulator without acceleration presents as a hung test
rather than as a missing prerequisite.

Use a **development build**, not Expo Go — the app depends on native
SecureStore behavior that Expo Go cannot provide.

## Running it

Check the machine first — the device lanes need tooling this repository
cannot pin:

```bash
npm run preflight:device    # reports what is missing; installs nothing
```

It exits 0 when Docker, a simulator or emulator, and Maestro are all
present, and 1 with a list when they are not. It is report-only by
design: what gets installed on your machine is your call.

```bash
npm ci
npm run env:synthetic          # writes a synthetic .env.local (0600, gitignored)
node scripts/local-supabase.mjs up
node scripts/local-supabase.mjs seed
npx expo run:android           # see the Android lane below; macOS only: npx expo run:ios
```

`env:synthetic` writes the loopback URL and a synthetic publishable-shaped
key. It is not a credential and the values are nonfunctional outside the
local stack. If you have your own `.env.local` it refuses to overwrite it
without `--force`.

Sign-in codes are delivered to the local Mailpit at
http://127.0.0.1:54324 — nothing leaves the machine.

Seeded synthetic accounts:

| Account                           | Sees                                                         |
| --------------------------------- | ------------------------------------------------------------ |
| `client.owner@example.invalid`    | Two workspaces (entities A1 and A2), so the chooser appears  |
| `client.second@example.invalid`   | One workspace under a different client                       |
| `reviewer.rae@example.invalid`    | Staff; requires TOTP and AAL2 before any protected row       |
| `preparer.pat@example.invalid`    | Staff across two different clients                           |
| `mixed.cross@example.invalid`     | Client on one entity, staff on another — the mixed-role path |
| `nomember.norman@example.invalid` | Nothing — the zero-access path                               |

`intake.beth@example.invalid` and `approver.avery@example.invalid` are
seeded too; the full matrix is `scripts/lib/synthetic-identities.mjs`.

Staff accounts enrol TOTP on first sign-in. `node scripts/totp-helper.mjs`
generates codes for the synthetic accounts during QA; the secret stays in
that process's memory and never reaches a file, a log, or a screenshot.

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
