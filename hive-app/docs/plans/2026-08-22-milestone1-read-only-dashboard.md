# Milestone 1 execution record — read-only client dashboard

Work Order 002 moved from draft to execution on Kody's instruction of
2026-08-22. Three checkpoints are complete and pushed.

## Authorization note

The WO-002 draft lists two **blocking** dependencies. Their status when
this work started, recorded so the decision is visible rather than
implied:

| Dependency                                | Status                                                                                                                                        |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| D1 — repository split to a dedicated repo | **Not done.** Work proceeded here; it relocates cleanly if the split happens                                                                  |
| D2 — Milestone 0 PASS                     | **Not met.** Milestone 0 is RETURN. Kody directed the move to Milestone 1 anyway; that reverses a standing PM instruction and the PM was told |
| D4 — Stacie's relationship language       | **Not supplied.** Placeholder wording is isolated in one module so it can be replaced without touching a screen, a query, or a migration      |

No production data, integration, signing, submission, or release work was
performed. Everything runs on synthetic `example.invalid` identities.

## Checkpoint 1 — read surfaces (schema, RLS, denial matrix)

Two protected tables, `requests` and `activity_events`, held to exactly
the Milestone 0 scope pattern rather than a parallel shape, because
WO-002 T1 names policy drift between tables as this milestone's threat:
composite foreign key into `cases`, indexed policy columns, a permissive
membership policy, and a restrictive staff-AAL2 policy ANDed on top.
`select` is the only grant, so no write policy exists to get wrong.

`activity_events` has **no free-text column**. Free text is how excluded
fields — names, filenames, financial values — reach a read surface, a log,
or a screenshot. A row carries an enumerated kind, an acting role, and a
server timestamp; the app owns the wording (threat T3).

## Checkpoint 2 — screens and navigation

Requests list and detail, Activity, Help, and the five labeled
destinations PRODUCT.md allows. Read-only throughout: no respond, upload,
or edit control exists in the binary, absent rather than disabled
(rollout control C3).

Scope binding, the derived-state reset during render, cancellation across
both scope AND membership switches, and error mapping live once in
`useScopedLoad`. The Milestone 0 dashboard was refactored onto it, and its
existing tests prove the extraction is faithful.

### Truthfulness corrections made while building

| Claim the screens could have made    | What they do instead                                                                                                                                                                  |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "As of <time>" from the device clock | "Recorded through <date>" — the newest SERVER timestamp actually present. With nothing to be current about, no claim is made at all (threat T4)                                       |
| Dates rendered through `Date`        | Parsed by parts. `new Date('2026-08-10')` is UTC midnight and renders as the previous day west of Greenwich, so a server-recorded date would appear to move with the phone's location |
| A support address or phone number    | Help says contact details will be listed once confirmed. Inventing a channel is inventing a channel                                                                                   |

## Checkpoint 3 — the case list, reload affordances, and accessibility

Two requirements were still only partly met after checkpoint 2. A re-read
of the work order found both.

**R1 — Home lists the scope's cases, newest first.** The Milestone 0
dashboard showed a single case, which is what the empty-state milestone
needed and not what R1 asks for. `DashboardRepository.load` now returns a
`ScopedList<CaseSummary>` built from three scoped queries plus in-memory
grouping, rather than one query per case — the N+1 that a naive list
would introduce is exactly the kind of thing that only shows up once a
workspace has more than one case. A second synthetic case was seeded
(`2024 books close (Synthetic)`, APPROVED, status changed 2026-06-30) so
newest-first ordering is provable rather than asserted against a
single-element list.

**R7 — a reload affordance on the screen itself.** Retry existed only
inside error and offline states, so a reader on a healthy screen had no
way to refresh: there is no background polling, by design. Home,
Requests, and Activity now each carry a `Refresh` control in the ready
and empty states, next to the "Recorded through" line, so what is being
refreshed and how current it is sit together.

**Two more Maestro flows** cover the read surfaces' state behaviour:
`read-surfaces-offline.yaml` proves offline REPLACES content rather than
ageing it (threat T4) and then recovers, and `read-surfaces-denied.yaml`
proves a revoked membership leaves no stale row on screen.

**A4 accessibility checks** now cover every Milestone 1 screen at the
screen level, not just the primitive level:
`read-surface-accessibility.test.tsx` renders each real view and asserts
that the first header names the screen, that every element responding to
a touch carries both a role and a non-empty accessible name, that each
control meets the 48dp height floor, that status is never colour-only,
and that Help ships no interactive control at all. Each assertion was
red-checked against a deliberate regression — a bare `Pressable`, a 32dp
button, and a title stripped of `accessibilityRole` — and each one failed
before being restored.

Interactive elements are found by the responder handlers React Native
attaches to a pressable's host view, never by `accessibilityRole`: a
role-based query cannot see the defect being looked for, which is an
element that reacts to a tap while carrying no role.

### Defect found and fixed: Account was not really a peer destination

The nav promises five peer destinations, but `app/settings.tsx` did not
use the authorized shell — so arriving at Account stripped the nav and
left a system back gesture as the only way out. That is neither a
persistent label nor discoverable with a screen reader, and it is the
one destination a reader is most likely to reach while looking for
something else.

Account now renders through `AuthorizedScreen` like the other four. Two
things had to hold at once: Account must stay on screen while sign-out
completes (so protected UI does not flash back), and the nav must not be
tappable in that state (a tap would push back into protected UI while the
session is being torn down). The shell takes an explicit `alsoAllow` list
for the first, and renders the nav only while `authorized` for the
second — absent, not disabled, because there is nothing to come back to.
`nav-persistence.yaml` walks all five destinations on a device and
asserts the nav survives arriving at each one.

### A testID collector that could go quietly weak

`maestro:validate` proves every flow selector matches a testID that
really exists. The shared state component renders `testID={testIDs.offline}`,
so the literal no longer sits next to the word `testID` and the collector
stopped seeing it — a flow could then have named a state id no screen
renders and still validated. The state ids are now a declared
`SCOPED_STATE_TEST_IDS` table and the collector parses that form
explicitly. Because this failure mode WEAKENS a check rather than
breaking it, the collector is now tested directly, against text naming
ids that appear nowhere in the app.

## Defect found and fixed: bundle inspector false positive

The real export failed `bundle:inspect` with
`unapproved-publishable-key`. The cause was **not** a leak. Hermes string
tables store adjacent entries with no separator, so printable-string
extraction fused the approved key with the copy string "No open requests"
added by this checkpoint, producing `sb_publishable_…0123456789No`. It
passed before only because no adjacent literal happened to start with a
key character.

Binary mode now accepts a match that STARTS WITH the approved key: a
different key is a different random token, not the approved one plus a
tail. The URL deliberately gets no such allowance — an approved origin is
a genuine prefix of a hostile suffix host, and a prefix test there would
reopen the bypass closed in RETURN-4 P1-4. Both directions are
regression-tested, including that text mode keeps exact equality.

## Browser evidence: both fail-closed paths, confirmed

The web export was served locally and rendered in headless Chromium.

| Variant                 | What rendered              | Why that is correct                                                                                                            |
| ----------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Production-mode export  | Configuration-fatal screen | A loopback URL is not allowed outside a development build; the release guard fired                                             |
| Development-mode export | Storage quarantine screen  | `expo-secure-store` has no web implementation, so session storage failed verification and the app refused to show protected UI |

Web is an export and inspection target only. iOS and Android are the
product, and neither has been run — the device lane stays HOLD.

## Gate results (2026-08-26, this container, re-run at checkpoint 3)

| Lane                                           | Result                                                                                           |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| verify:toolchain                               | exit 0 — Node 22.23.2, npm 10.9.8, Expo 57.0.11, RN 0.86.2, React 19.2.3, TS 6.0.3               |
| lint / format:check / typecheck                | exit 0 / exit 0 / exit 0, zero warnings                                                          |
| jest                                           | **369 tests**, 29 suites, all passing (331 at checkpoint 2, 276 before this milestone)           |
| node:test script suites                        | **250 tests**, all passing (248 at checkpoint 2)                                                 |
| pgTAP                                          | **120 tests** across 7 files (86 across 6 before), all passing                                   |
| db:types:check                                 | exit 0 — committed types still match the schema                                                  |
| maestro:validate                               | exit 0 — **16 flows**, 4 helper scripts                                                          |
| config:check (development)                     | exit 0                                                                                           |
| expo export --platform all                     | exit 0 — **15 routes**                                                                           |
| bundle:inspect (development)                   | exit 0 — 20 text + 53 binary files                                                               |
| export:candidate / --qa-control                | exit 0 / exit 0 as a control (QA export correctly REJECTED on all three platform bundles)        |
| secrets:scan                                   | **exit 3 (HOLD)** — 4 history exceptions proposed, not ratified                                  |
| audit:gate                                     | **exit 3 (HOLD)** — 2 waivers proposed, not ratified                                             |
| iOS/Android builds, devices, Maestro execution | **HOLD** — no device, simulator, or Maestro binary here                                          |
| Supabase CLI stack (Docker)                    | **HOLD** — Docker client present, daemon unreachable; pgTAP ran on the local PostgreSQL fallback |

The two HOLD exits are the designed fail-closed state, not a regression:
every waiver and history exception stays `proposed` under the standing
instruction not to ratify anything.

## Clean-checkout drill at `abcabe8`

The pushed branch was cloned fresh into an empty directory and every
runnable gate was executed there, so what is recorded above is a property
of the repository and not of this working tree.

| Step                                 | Result                                                                                  |
| ------------------------------------ | --------------------------------------------------------------------------------------- |
| `git clone --single-branch`          | HEAD `abcabe89d8129ed818c84086842d30ed1365eabf`                                         |
| `npm ci`                             | exit 0 — from the lockfile alone, no `npm install`                                      |
| verify:toolchain                     | exit 0                                                                                  |
| lint / format:check / typecheck      | exit 0 / exit 0 / exit 0                                                                |
| jest                                 | exit 0 — **377 tests**, 30 suites                                                       |
| node:test script suites              | exit 0 — **250 tests**                                                                  |
| maestro:validate                     | exit 0 — 17 flows, 4 helper scripts                                                     |
| config:check, before `env:synthetic` | **exit 1 — correctly missing both public values**; the repo carries no environment file |
| `env:synthetic` → config:check       | exit 0; the generated `.env.local` is mode 0600 and matched by `.gitignore`             |
| db:types:check                       | exit 0                                                                                  |
| pgTAP (fresh port, own cluster)      | exit 0 — 120 tests across 7 files                                                       |
| expo export + bundle:inspect         | exit 0 / exit 0                                                                         |
| export:candidate / --qa-control      | exit 0 / exit 0 (QA export correctly REJECTED)                                          |
| secrets:scan / audit:gate            | exit 3 / exit 3 — the same designed HOLD, reproduced from a clean clone                 |

`git status` in the clone afterwards showed **only** the two candidate
export evidence records as modified: no gate mutates a tracked source in
order to pass.

## A3 in this container: the Docker block, and the binary stack built around it

Investigated 2026-08-27, after the standing assumption "no Docker here"
turned out to be only half true.

**The Docker daemon runs; the images cannot arrive.** `dockerd` is
installed and starts cleanly (server 29.3.1). What fails is every image
pull: the environment's network policy answers 403 at the gateway for the
registries' blob CDNs — `production.cloudfront.docker.com` (Docker Hub)
and `d2glxqk2uabbnd.cloudfront.net` (ECR Public), while the registry API
hosts themselves resolve. So the Supabase CLI stack is blocked by the
session's egress allowlist, not by the machine. Adding those CDN hosts to
the Claude Code environment's network policy would make
`local-supabase.mjs up` work here natively.

**The binary stack (`scripts/e2e-binary-stack.mjs`).** Rather than wait,
the same serving software was brought in without Docker: GoTrue v2.196.0
built from its pinned source tag with the preinstalled Go toolchain,
PostgREST v13.0.8 and Mailpit v1.31.0 as official release binaries
(GitHub release assets are reachable), all sha256-pinned and verified
before every start, on the system PostgreSQL 16 the pgTAP lane already
uses. A ~40-line loopback router stands where Kong stands: `/auth/v1/*`
to GoTrue, `/rest/v1/*` to PostgREST, the P0-1 OTP template served to
GoTrue, everything else refused, non-loopback peers refused outright.
The UNMODIFIED `e2e-local-auth.mjs` harness and `seed-local.mjs` run
against it through the same `HIVE_LOCAL_*` contract as the CLI lane.

Labeling, so the evidence cannot overclaim: this lane is always reported
as the **binary stack**. It proves real GoTrue OTP/TOTP/AAL semantics,
real PostgREST JWT-to-role switching, and this repository's actual
migrations, RLS, and seed over HTTP. It does not prove Kong's gateway
behavior, the CLI's composition, or the publishable-key front door; its
keys are legacy JWT-shaped, which policy permits only for loopback
development and the release gates reject.

**Status: EVIDENCED — 157 passed, 0 failed, three consecutive full runs.**
Kody authorized the run on 2026-08-27. `node scripts/e2e-binary-stack.mjs
run` brings the stack up from nothing, seeds nine login-capable users
through the real GoTrue Admin API (all canonical UUIDs, 15 memberships
via PostgREST), executes the unmodified black-box harness, writes
`security/evidence/e2e-binary-stack.json`, and tears down. The harness
covered, against the real services: OTP sign-in for every seeded account
with the code taken from a real Mailpit email under the exact P0-1
subject; JWT `sub` equal to the canonical definition everywhere; refresh
rotation with retained AAL; unknown-email rejection with no account
creation; TOTP enrollment, challenge, verify to AAL2; and the full
PostgREST reach/denial matrix — staff at AAL1 zero rows, AAL2 exact
reach, cross-client and cross-entity zero, unknown request ids returning
no existence signal.

Found while getting there, all fixed in the orchestrator: GoTrue's
default SMTP send-frequency floor (a minute) fails the harness's
deliberate repeat-OTP requests — config.toml sets `max_frequency = "1s"`
and the stack now mirrors it; back-to-back runs raced the old Mailpit
for its SMTP port, so `stop` now waits and escalates to SIGKILL; and the
post-kill wait had to be bounded, because a detached parent never reaps
its children and `kill(pid, 0)` succeeds on a zombie forever. One
honesty note: the very first cold run had a single failed assertion
(150/157 with sections short-circuited) that could not be captured
before the output scrolled and has not reproduced across three
subsequent complete runs, two of them cold starts. It is recorded here
rather than forgotten; if it reappears, the run log under
`.cache/e2e-stack/logs` is where to look.

### One layer deeper: the app's own composition, live (2026-08-27)

The black-box harness proves the server; the jest suites prove the
client against fakes. The seam between them — the exact composition
`src/app-runtime.ts` ships — had never run against anything real. It now
has: `node scripts/e2e-binary-stack.mjs bridge` builds that composition
verbatim (real `AuthController`, real supabase-js bundle with the
session write-gate, real scoped repositories, the REAL SecureStore
adapter with its versioned envelope and residue checks), swapping only
the two native byte stores for named in-memory synthetics, and drives
three full journeys against the live stack. **3/3 passing, three
consecutive runs**, recorded in `security/evidence/app-live-bridge.json`:

- **Client journey** — OTP requested by the controller, six-digit code
  read from the real Mailpit email, two-workspace chooser (the app must
  ask, not pick), scope selected, Home/Requests/Activity loaded through
  the app's own repositories with the canonical rows newest-first,
  cross-scope request id returning null with no existence signal, then a
  sign-out whose storage deletion the adapter VERIFIES and the synthetic
  backend confirms empty — after which the client accessor refuses reads.
- **Staff journey** — after OTP the only reachable state is
  `mfa_required`: the app never offers a workspace at AAL1. TOTP
  enrollment uses the secret the state exposes once, verification lands
  the canonical scope, and reads return rows where AAL1 had none.
- **Identity switch** — a second person on the same install starts from
  zero: no membership of the first identity's client is visible.

Two live findings folded back in: GoTrue's one-second send floor
surfaces in the app as `OTP_REQUEST_FAILED` with a notice — the journey
now answers it the way the screens do, through the public `requestOtp()`
resend, asserting the failure is shown rather than swallowed; and
jest-expo's Expo fetch polyfill cannot reach a network, so the lane
snapshots Node's real fetch before the preset loads and restores it
after. The lane never runs in `npm test` (own jest project, latch env,
loopback-only refusal).

### The screens themselves, live — and the lane made deterministic

Later on 2026-08-27, two more layers landed on the same stack:

**The real screens rendered real data** (`tests/live/screens-live.test.tsx`,
part of the `bridge` command — both live suites now total **7/7**).
`AuthProvider` was mounted around the actual `DashboardScreen`,
`RequestsScreen`, and `RequestDetailScreen`, over the live composition,
after a real OTP sign-in: Home showed the canonical cases newest-first
with the server recorded-through line and the server-confirmed workspace
name; Requests listed the synthetic rows; a cross-scope request id
rendered exactly "Request not found here" with nothing about client B
anywhere in the tree; and sign-out stripped every protected row off the
glass, after which the screen renders nothing. Only the device lane can
claim pixels; this claims everything up to them.

**The black-box flake was finally caught and root-caused.** The
single-assertion failure first seen on the lane's first cold run
reappeared and this time was logged: GoTrue's email send floor
(`max_frequency = "1s"`) refuses a request landing in the same
wall-clock second as another send — its own error says "you can only
request this after 0 seconds". That is an anti-abuse control's edge, not
the behavior under evidence, and the APP's handling of the floor (notice
shown, resend offered) is separately proven by the bridge suite. The
synthetic loopback lane therefore disables the floor
(`GOTRUE_SMTP_MAX_FREQUENCY=1ns`) — a documented, deliberate divergence
from config.toml, which still governs the CLI stack. Two consecutive
full runs after the change: **157/157, 157/157**.

**Reproducibility on other machines**: `npm run fetch:e2e-binaries`
downloads postgrest and mailpit from their pinned release assets
(archive sha256 verified BEFORE extraction) and builds gotrue from the
pinned tag, refusing a tag that has moved off its recorded commit. A
locally built Go binary embeds local paths, so its digest is
machine-specific; the script records the verified build's digest and the
stack accepts that record for gotrue only.

**Expo Doctor** (a VERIFICATION gate, first run 2026-08-27): **19/21
checks pass**. The two failures are the two network-dependent checks —
the config-schema fetch and the React Native Directory validation — both
receiving this container's egress-proxy denial text instead of JSON.
Re-run on the desktop for the full 21.

### Clean-checkout drill at `5ed066b`: the whole system from git alone

Fresh clone of the pushed branch into an empty directory; `npm ci` from
the lockfile; `npm run fetch:e2e-binaries` producing every stack binary
from nothing (postgrest and mailpit from the pinned, digest-verified
release archives; gotrue REBUILT from the pinned tag, commit verified);
then both live lanes:

| Drill step                           | Result                                      |
| ------------------------------------ | ------------------------------------------- |
| clone → HEAD                         | `5ed066b`                                   |
| npm ci                               | exit 0                                      |
| fetch:e2e-binaries (cold)            | exit 0 — downloads verified, gotrue rebuilt |
| black-box harness (`run`)            | exit 0 — **157 passed, 0 failed**           |
| app composition + screens (`bridge`) | exit 0 — **7 passed, 0 failed**             |

One environmental footgun surfaced and is now documented: the checkout's
ancestor directories must be traversable (`o+x`) by the `hivepg` system
user, or `initdb` fails with permission denied — a property of where the
repo is cloned, not of the repo.

**What this changes for A3:** the acceptance item's substance — the
black-box behavior of auth, RLS, and the read surfaces through real
serving software — is now evidenced in this container, at the binary-
stack level. The CLI-composition run (Kong, publishable-key front door)
remains outstanding and lands either on the desktop with Docker or here
once the two CDN hosts above are allowlisted.

## WO-002 acceptance status

| Item                                  | Status                                                                                                                        |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| A1 — pgTAP RLS + negative matrix      | **Met.** 120 tests across 7 files, including mixed-role AAL1 zero-row proofs for both new tables                              |
| A2 — repository/screen contract tests | **Met.** ScopeKey required; late responses dropped across scope AND membership switches; every state renders per screen       |
| A3 — black-box e2e through PostgREST  | **HOLD.** Harness and fixtures updated and committed; it cannot run without the Supabase CLI stack, and Docker is unreachable |
| A4 — accessibility jest checks        | **Met for the jest lane** (see checkpoint 3). Device screen-reader QA and measured contrast on hardware stay HOLD             |
| A5 — Maestro device flows             | **Authored and validated, HOLD to execute.** 17 flows parse and every selector resolves; no Maestro binary or device here     |
| A6 — Milestone 0 gates re-run green   | **Partly.** Every runnable gate is green above; the Docker and device lanes stay HOLD, and D1 (repo split) has not happened   |

### The iOS half of A3 and A5 needs hardware nobody on this project has yet

Confirmed 2026-08-26: the machine available to run the device lanes is a
**Windows desktop**. Xcode is macOS-only, so the iOS build, the iOS
simulator, and the iOS half of the Maestro lane cannot be produced there
at any cost. This is not a missing install, and no amount of local setup
clears it.

What that splits the outstanding evidence into:

| Lane                                     | On a Windows desktop                                                                             |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------ |
| A3 — black-box e2e through PostgREST     | **Reachable.** Docker plus Node; no Apple toolchain involved                                     |
| A5 — Android half, and the Android build | **Reachable.** Android Studio, an AVD with WHPX, and Maestro                                     |
| A5 — iOS half (running the flows)        | **HOLD.** Needs a Mac or a hosted Mac runner — see the EAS note below, which does NOT close this |
| The iOS build compiling at all           | **HOLD, but cheaply cleared** by a cloud build — see the EAS note below                          |
| Screen-reader QA — TalkBack              | **Reachable** on the Android emulator or a physical device                                       |
| Screen-reader QA — VoiceOver             | **HOLD.** Same hardware dependency as the iOS build                                              |

So the brief's "dependable iOS and Android app" has a hardware gap on the
iOS side. It is an approval and procurement question (owner Kody), not an
engineering one. `preflight:device` reports it as BLOCKED rather than as a
finding, so it stays visible on every run without training anyone to
ignore a permanent failure.

### The Android lane, and two things found by actually attempting it

Set up 2026-08-26. Nobody had run an Android build before, and doing the
setup surfaced two facts that no amount of reading would have.

**The emulator cannot reach the stack at `127.0.0.1`.** Inside an Android
emulator that address is the emulator itself; the host's loopback is
`10.0.2.2`. `env:synthetic` wrote only `127.0.0.1`, so the lane would have
failed looking exactly like a backend outage rather than an addressing
mistake. `security/approved-config.json` now approves both origins for
**development only** — they name the same stack, and `src/core/env.ts`
already classified `10.0.2.2` as loopback, so the intent was understood
even though nothing produced it. `npm run env:synthetic -- --android-emulator`
selects it. On a physical device over adb neither address works: that
needs `adb reverse tcp:54321 tcp:54321` and the plain origin.

**The template opens cleartext far wider than expected — the opposite of
what was assumed.** The initial read of the generated main manifest
suggested targetSdk 36 would deny cleartext and block the local stack.
That was wrong for the build that actually runs. The Expo/React Native
template ships a _debug source-set_ manifest containing
`android:usesCleartextTraffic="true"`, which permits plaintext HTTP to
**every host** in a debug build. So cleartext was never the blocker; it
was already wide open, which SECURITY.md's "preserve Android cleartext
denial" does not contemplate.

`plugins/with-android-debug-loopback.js` therefore **narrows** rather
than enables: it swaps the blanket attribute for a network security
config denying cleartext by default with exactly three exceptions
(`10.0.2.2`, `127.0.0.1`, `localhost`). It patches the manifest in place
rather than rewriting it — an earlier version wrote the file wholesale
and silently dropped the `SYSTEM_ALERT_WINDOW` permission the React
Native dev menu needs. It throws if the template ever stops shipping the
blanket attribute, because doing nothing quietly would leave someone
believing cleartext was narrowed when nothing had run.

It covers `debug` **and** `debugOptimized`: those are separate Gradle
build types and source sets do not inherit, so covering only `debug`
would leave the second on the blanket permission. A **release** build is
untouched and carries no cleartext exception of any kind — the main
manifest is deliberately left alone, which is what makes that true.

`config:check` fails if the plugin stops being registered, and the
transform is unit-tested against the captured template text since no
Android toolchain exists in the container.

**For Kody:** this is a net tightening of the debug posture, but it is
still a change to how the app treats cleartext, and security decisions
are yours. The narrow config replaces a blanket permission that was
already there; nothing that was previously denied is now permitted.

### Option considered: EAS Build for the iOS half

> **Unverified.** `docs.expo.dev`, `expo.dev`, and `maestro.mobile.dev` are
> all blocked by this container's network egress policy, so none of the
> specifics below were confirmed against current vendor documentation.
> They come from model training with a May 2026 cutoff, and the source
> order in CLAUDE.md puts current official vendor docs above that. Confirm
> every line before committing money, an account, or a plan to it.

EAS Build compiles iOS on hosted macOS workers, so it does remove the
need for a Mac to **produce** a build. It does not remove the need for one
to **run** a build, and "the iOS half" is three separate things:

| Question                            | What EAS Build answers                                                                                                     |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Does the iOS target compile at all? | **Yes** — and this is currently unknown, because nobody has ever built this app for iOS                                    |
| Can the app be run and looked at?   | **No** — see the artifact split below                                                                                      |
| Can the iOS Maestro flows execute?  | **Probably not.** Maestro's iOS driver is understood to require macOS (XCUITest/idb). This is the load-bearing uncertainty |

The trap is which artifact a profile produces. A **simulator** profile
needs no Apple Developer account and no signing, but yields a `.app` that
only runs on a macOS Simulator — which is exactly the thing a Windows
desktop does not have. A **device** `.ipa` runs on a physical iPhone, but
requires Apple Developer Program membership and signing credentials.

Two authority gates sit above the technical answer, and neither is
cleared by paying for a plan:

- **Signing is HOLD** under CLAUDE.md ("production data, integrations,
  signing, submission, and release are HOLD"). The device `.ipa` path
  needs Kody's explicit authority, not a subscription.
- **Account, terms, and spend.** Creating an Expo account and accepting
  EAS terms is squarely inside "never alter accounts, accept terms, spend,
  publish, deploy, message ... without exact authority". EAS Build also
  uploads the project to Expo's servers to build it. Everything here is
  synthetic so nothing sensitive moves, but it is still an outward
  transfer of the codebase to a third party, and that is a decision.

One precision, because the two are easy to conflate: the brief and ADR
0001 exclude **EAS Update** (over-the-air delivery). They do not name
**EAS Build**, which is a different product. So EAS Build is not
pre-excluded — but "no OTA lane until signing, rollout, rollback, and
approval are tested" sets the posture for anything in that family.

**Recommendation.** A simulator-profile EAS build is worth doing on its
own merits: it needs an account and terms acceptance but no Apple account
and no signing, and it answers a question that is currently completely
open — whether this app compiles for iOS at all. That is real movement on
the VERIFICATION gate for a small authority ask. It does **not** deliver a
runnable app, VoiceOver QA, or iOS Maestro coverage; for those, a Mac mini
or a hosted Mac runner is the honest answer, and signing stays HOLD either
way.

**Built 2026-08-26, on instruction.** The simulator lane is now
configured. What exists, and what deliberately does not:

| File                    | What it does                                                                                       |
| ----------------------- | -------------------------------------------------------------------------------------------------- |
| `eas.json`              | Exactly one profile, `ios-simulator`, with `ios.simulator: true`. No `submit` block, no other lane |
| `.easignore`            | A complete superset of `.gitignore`, so the upload set is auditable and `.env.local` cannot leave  |
| `scripts/eas-guard.mjs` | Fails the build lane closed if any of that drifts; wired in as `npm run eas:guard`                 |

`.easignore` is written as a superset rather than a list of extras on
purpose. Where a `.easignore` exists it is understood to take the place of
`.gitignore` for deciding the upload set, so a file listing only additions
would silently begin uploading everything `.gitignore` excludes —
`.env.local` included. As a superset the upload set is identical under
either precedence rule. `eas:guard` asserts the property directly, and the
negative test for it uses a `.easignore` written the wrong way.

The guard refuses: any profile other than the authorized one (even a
second simulator-only profile — one lane was authorized, not any safe
lane), an iOS block where `simulator` is false OR merely absent (absence
produces a device build, so it is treated as one rather than defaulted),
any `submit` configuration, any Apple-account or credential key at either
nesting level, and an `android` block. Both refusals were exercised
against realistic drift, not just fixtures: a copied `production` profile
plus a `submit` block produced four findings, and an additions-only
`.easignore` produced twenty-five, naming `.env*.local` among them.

**Verified here before spending a build credit.** `expo prebuild
--platform ios` succeeds, emitting bundle identifier
`com.myhbcfo.hive.development` at deployment target 16.4 with
`NSAllowsArbitraryLoads=false` in the Info.plist. It also succeeds with
`.env.local` removed, which is what EAS will see — and so does the Metro
bundle step that the Xcode build phase runs. So the build should compile,
and the artifact will carry no Supabase configuration and reach the
configuration-fatal screen on launch. That is correct: this lane answers
"does it compile", not "does it work".

**Not done, and not doable from here.** No Expo account exists, no terms
have been accepted, and no build has been run — `expo.dev` is blocked by
this container's egress policy, and the account and terms are Kody's
decision regardless. The `eas.json` schema itself could not be checked
against current vendor documentation for the same reason; the file encodes
the security decisions correctly, but confirm the key names against docs
reachable from a normal network before the first run.

## Next

Device-lane evidence for both milestones, owner Kody. Three decisions are
waiting, and they are independent of each other:

1. **Android and A3 on the Windows desktop** — no approval needed beyond
   installing tooling; `npm run preflight:device` reports what is missing.
2. **A simulator-profile EAS build** to establish that iOS compiles —
   needs an Expo account and terms acceptance, nothing else.
3. **A Mac or hosted Mac runner** for anything that has to RUN on iOS —
   VoiceOver QA, the iOS Maestro flows, TestFlight later.

The run path for (1) is in README.md.

## 2026-08-28 — first Windows desktop execution: twelve composition finds

The Windows desktop (item (1) above) reached a fully green
`preflight:device` — Node 22.23.2/npm 10.9.8 after displacing a
pre-existing Node 24, Docker Desktop on the WSL2 backend, Android Studio
with a Pixel_8 API 36 AVD, WHPX acceleration, 7.8 GB RAM — and the first
real execution of the device lane surfaced twelve defects that no
container run could have, because no prior machine could run this lane
at all (finds 11–12 landed 2026-09-03, on the SECOND desktop's
first-ever Maestro execution — that bring-up itself took under two
hours and added only two new environment notes, PowerShell's
Restricted execution policy and a machine without WSL):

1. **preflight said ready on a machine that could not build.** Gradle
   needs a JDK; Android Studio ships one but exports no `JAVA_HOME` and
   touches no PATH, so every Android line was green while
   `expo run:android` would have died in its first minute. preflight now
   probes the JDK (`resolveJdk`, mirroring gradlew's own resolution
   order: an explicit `JAVA_HOME` decides alone — gradlew refuses an
   invalid one rather than falling back to PATH). Commit c6d8ad3.

2. **local-supabase.mjs could not launch the CLI on Windows at all.**
   npm ships `npx` there as a `.cmd` batch wrapper that CreateProcess
   cannot execute directly, so every invocation died at spawn with
   ENOENT — and the error path interpolated the absent stdout/stderr as
   the literal text "undefined" in place of the reason, while the canned
   message misattributed the failure to registry access. `runCli` now
   passes `shell` on win32 (hardcoded-literal arguments only, the same
   justification as preflight's `run()`), and `describeRun` surfaces
   `result.error` for a process that never launched.

3. **No ordering of `up` and `env:synthetic` produced a configuration an
   emulator could sign in with.** `up` wrote the real local key with
   `127.0.0.1` (which inside an emulator is the emulator); `env:synthetic
--android-emulator` wrote the reachable `10.0.2.2` origin with a
   deliberately nonfunctional key; the README sequence ran the latter
   first and `up` then clobbered it. The lane is now one step:
   `up --android-emulator` writes the REAL local key with the
   manifest-approved `10.0.2.2` origin (`selectWrittenOrigin`: the origin
   comes from security/approved-config.json only, never assembled, and
   its port must match the running stack's). README corrected for both
   the emulator path and the physical-device path (`adb reverse` with
   plain `up`); `env:synthetic` remains the no-Docker gate-lane tool it
   was built as.

4. **The JDK presence check was not a JDK suitability check.** With
   `JAVA_HOME` pointed at Android Studio's bundled JBR, preflight said
   ok — and the first real Gradle build ran EIGHTEEN MINUTES before
   `configureCMakeDebug` failed on react-native-screens and
   react-native-worklets with JEP-472 "restricted method in
   `java.lang.System`" errors: that JBR is newer than the Android Gradle
   Plugin supports. `resolveJdk` now reads the version too
   (`parseJavaMajor`) and holds it to 17–21 — 17 is React Native's
   documented minimum, 21 the observed upper bound, encoded with the
   observation date rather than guessed; an unreadable vendor string
   reports what it saw instead of inventing a verdict. The desktop lane
   moved to Temurin 21 with `JAVA_HOME` repointed; Android Studio keeps
   its own JBR for itself.

5. **The first real Android resource link found a dangling splash
   reference the config lanes could never reach.** With the JDK right,
   the build marched to `:app:processDebugResources` and aapt2 refused:
   `resource drawable/splashscreen_logo not found`. The splash
   configuration is deliberately imageless (text-only development mark,
   asset release HOLD) — but expo-splash-screen 57.0.7's Android plugin
   writes `windowSplashScreenAnimatedIcon → @drawable/splashscreen_logo`
   into the theme unconditionally while only generating the drawable
   when an `image` is configured. New local config plugin
   `with-android-imageless-splash` removes the dangling item after
   expo-splash-screen writes it; it throws rather than no-ops when the
   group or the reference is missing, so an upstream fix retires it
   loudly, and it must be REMOVED the day an approved splash image
   ships. Registration order is load-bearing and pinned by test: mods
   execute in reverse registration order, so the plugin sits FIRST in
   app.json's plugins array to run last — proven by a real
   `expo prebuild -p android` both ways, and the corrected order's
   generated `res/` greps clean of `splashscreen_logo` while the theme
   keeps its background, post-splash theme, and behavior.

6. **The CLI stack's email provider was off, so no OTP could ever
   send.** The first real sign-in answered
   `422 email_provider_disabled "Email logins are disabled"` to a
   seeded user's OTP request. Root cause is a naming trap in
   `supabase/config.toml`: `[auth.email].enable_signup` reads like a
   second signup switch but maps to GoTrue's `EXTERNAL_EMAIL_ENABLED` —
   the provider itself — and it was set `false` alongside the correct
   invite-only `[auth].enable_signup = false`. The binary-stack lane
   was never affected because it sets GoTrue's environment explicitly
   and already ran the proven pair (`GOTRUE_DISABLE_SIGNUP=true`,
   `GOTRUE_EXTERNAL_EMAIL_ENABLED=true`, 157/157). config.toml now
   carries `[auth.email].enable_signup = true` with the mapping
   documented in place; invite-only remains enforced by the global
   switch, and the unknown-email strict-422 negative is unchanged —
   it is the same semantics the black-box suite already passes under.

7. **The analytics container cannot run on Windows without an
   unacceptable Docker setting, and its health check takes the whole
   stack down.** The first `supabase start` restart failed on
   `supabase_analytics_hive-app: unhealthy` (Logflare's endpoint never
   comes up); the CLI's own warning names the requirement — the Docker
   daemon exposed on `tcp://localhost:2375`, an unauthenticated control
   socket this project will not accept. `[analytics] enabled = false`
   in config.toml: no HIVE lane reads Logflare (auth, PostgREST, the
   mailbox, seed, and both e2e suites are independent of it), the first
   morning `up` having passed its health check was timing luck, and the
   dropped container frees real memory on the 8 GB desktop.

8. **A stop/start restore can leave synthetic accounts outside the
   canonical shape.** After the restarts, `client.owner@example.invalid`
   existed with ZERO auth identities; the seed's verification refused to
   bless the state — correctly, and the account still signed in, because
   GoTrue is more forgiving at runtime than the verifier is on purpose —
   but the refusal left the operator with no path forward. The failure
   message now explains the drift and prints the rebuild
   (`supabase db reset`, then seed); the harness still never deletes
   accounts. Commit 997866d.

9. **The harness's service credential worked at GoTrue and failed at
   PostgREST.** After a clean `db reset`, all nine users created and
   verified canonical — and the very next step, the membership insert,
   answered 403 with full service authority in hand. The CLI's
   new-style `sb_secret` key satisfies Kong's `apikey` gate and GoTrue,
   but PostgREST reads roles from a JWT: an unparseable bearer demotes
   the request to `anon`, whose table grants migration
   20260821120002 deliberately strips. (The binary lane never hit this
   because it mints its own JWTs.) `runHarness` now separates the two
   header roles — `HIVE_LOCAL_GATEWAY_KEY` (an issued key, for Kong)
   from `HIVE_LOCAL_SERVICE_KEY` (a service_role JWT bearer: the
   stack's legacy one when issued, else minted from the stack's JWT
   secret via `mintServiceRoleJwt`/`chooseServiceBearer`, defaulting to
   the CLI's fixed local secret) — and PROVES the credential with a
   PostgREST probe before any harness runs, so a wrong secret fails
   loudly at the door instead of deep inside a run. Loopback-only, as
   before; nothing is printed or persisted.

10. **service_role had no grants at all on this schema's tables in the
    CLI stack.** Find 9's pre-flight probe earned its keep on its first
    outing: it was refused (403) while presenting the STACK-ISSUED
    legacy service_role JWT — a credential that parses perfectly — so
    the bearer hygiene was necessary but not sufficient, and the true
    gap was authorization. The baseline had been environmental all
    along: supabase-shim.sql sets default privileges granting
    service_role ALL before migrations run on the self-hosted lanes,
    and the hosted platform provisions the same, but the CLI image does
    neither for tables these migrations create. Migration
    20260828120007_service_role_platform_grants.sql now carries the
    baseline explicitly (usage + all on tables/sequences/functions in
    public, plus matching default privileges), changing nothing for
    anon or authenticated. Verified on the fallback database lane:
    migration applies, pgTAP **120/120 across 7 files** still green,
    `has_table_privilege('service_role', 'public.memberships',
'SELECT'/'INSERT')` both true, and a live `set role service_role;
select count(*)` succeeds — the exact operation the CLI stack
    refused. The corrective half of the proof lands when the desktop's
    next `db reset` + seed completes.

11. **Maestro 2.10.0's on-device driver wedges on `inputText` under
    Android API 36.** The sign-in flow launched, asserted, and tapped,
    then the driver went silent for the full 120s gRPC deadline on the
    first text entry (`DeviceServerDiedException ... DEADLINE_EXCEEDED`,
    twice, reproducibly). Taps work; typing does not. The Maestro lane
    therefore runs on an **API 35** AVD — the app itself still builds
    for and runs on API 36 (compileSdk/targetSdk unchanged, and the
    manual QA evidence stands on API 36 emulators); only the flow
    runner's device is pinned back. Environmental, recorded in the
    runbook rather than the repo.

12. **The first flow execution crashed in our own helper:
    `otp-fetch.js` declared `found` as `const` and reassigned it** —
    GraalJS threw `Assignment to constant "found"` at the exact moment
    a fresh OTP message WAS found, proving the entire pipeline (type →
    snapshot → submit → email → fetch) worked around the one wrong
    keyword. Two lint layers had let it escape: the `.maestro`
    dot-folder is invisible to `eslint .`, and no rule baseline applied
    to those scripts even when linted directly. Now: `let found`, an
    eslint block applying js/recommended to `.maestro/**/*.js` (their
    GraalJS globals declared per-file via `/* global */`), and the lint
    script names the folder explicitly — red-checked (no-const-assign
    fired on the unfixed line, alone) before the fix went in.

Fresh counts at the commits recording this entry: node:test **310
passed, 0 failed** (23 new across finds 1–5 and 9, positives and
negatives; finds 6–8 are configuration and messages corrected against
observed stack behaviour), pgTAP **120 passed, 0 failed** on the
fallback lane with the find-10 migration applied, eslint
`--max-warnings 0` clean, prettier clean.

**Device evidence delivered, 2026-08-28.** After the find-10 migration
landed (`db reset` listing 20260828120007, seed completing canonical),
the full journey ran on the desktop's Pixel_8 emulator against the live
CLI stack: OTP email to the local mailbox, code verification, the
workspace chooser showing both Harbor Light memberships
(client-access subtitles correct), and Home signed into Harbor Light
Bakery LLC (Synthetic) — both synthetic cases newest-first (2025 books
close, "Needs attention / Waiting on records", above the approved 2024
close), status conveyed by icon and words rather than colour alone,
"Recorded through August 28, 2026" from the server, Refresh present,
all five nav destinations, Brand Kit v2.0 throughout. Screenshots
captured by Kody (synthetic data is cleared for QA screenshots): the
sign-in screen, the chooser, and signed-in Home — the project's
first-ever pixel evidence, closing the desktop bring-up.

**Phase 6, first two lanes, same evening.** The CLI-composition e2e —
the one lane no cloud container could ever run — completed on the
desktop against the live CLI stack: **e2e-local-auth: 157 passed, 0
failed**, covering all nine identities' OTP journeys with canonical JWT
subs, the unknown-email negative (no account created), TOTP enrollment
to AAL2 with repeat-login against the existing factor, mandatory
refresh rotation at AAL1 and AAL2, and the full AAL1-zero /
AAL2-exact-ID row matrices including the cross-client and cross-entity
zeros. expo-doctor on an unrestricted network: **20/21** — the one
failure is patch drift, not breakage: twelve packages now trail the
current SDK 57 patch releases (expo ~57.0.18 vs the pinned 57.0.11,
react-native 0.86.3 vs 0.86.2, and ten more), because the pins are
exact by design and upstream moved in the week since they were locked.
The deliberate patch-refresh is filed as cloud work with a full gate
sweep. Remaining desktop evidence: Maestro flows on the emulator.

## 2026-09-03 — Phase 6 final lane: Maestro on the API 35 emulator

The last outstanding desktop evidence. The lane now executes: the
instrumentation failure that blocked it is cleared, and the first flows in
this project's history have run green on a device. Two more finds landed,
numbered 13 and 14 in the running list, and the second one is a P0.

### The blocker itself was environmental, and took three separate clears

`maestro test .maestro/sign-in.yaml` had been dying at instrumentation
start with `java.io.EOFException`. Uninstalling Maestro's two driver
packages (`adb uninstall dev.mobile.maestro`, `.maestro.test`) cleared the
EOF — both answered `DELETE_FAILED_INTERNAL_ERROR`, i.e. already absent,
so what was stale was the adb-side state rather than the packages. The run
then reached the workspace chooser before the driver's gRPC channel died
mid-`viewHierarchy` with the adb transport reporting `device offline`; the
emulator had NOT rebooted (uptime unbroken), so this was the host adb
connection dropping, not a crash. A second run died the same way on the
first tap. A cold boot (`adb emu kill`, `adb kill-server`, then
`emulator -avd Pixel_8 -no-snapshot-load`) ended the driver deaths for the
rest of the session: every subsequent flow ran to a real assertion result.

### Find 13 — Maestro text selectors are regexes, and `(Synthetic)` is a capture group

The cold-booted run reached the chooser and failed honestly:
`Element not found: Text matching regex: Harbor Light Bakery LLC (Synthetic).*`.
Maestro matches a text selector as a REGEX, so unescaped `(Synthetic)` is a
capture group — the selector asks for the literal text
"Harbor Light Bakery LLC Synthetic", which no screen renders. Five
occurrences across three flows; other flows had escaped theirs
(`\(Synthetic\)`), so the defect was inconsistency rather than a
misunderstanding.

**The `assertNotVisible` half is the serious one.** `scope-switch.yaml`
carried `assertNotVisible: '2025 books close (Synthetic)'` twice — the
assertions that prove prior-entity content does not survive an entity
switch. Against text no screen renders, a "not visible" assertion cannot
fail. Both were passing vacuously, so the flow's cross-entity leak check
was a check in name only. A wrong `tapOn` fails loudly; a wrong
`assertNotVisible` fails silently forever, which is why this is recorded as
a defect rather than a typo.

**A second, independent defect in the same selectors.** Escaping alone
would not have made them correct. The chooser renders each row as the
entity name over `"<client> · <role>"`, and BOTH memberships belong to
client Harbor Light Bakery LLC (Synthetic) — so
`Harbor Light Bakery LLC \(Synthetic\).*` matches the Holdings row's
subtitle and the Holdings row's accessibility label as well as the Bakery
row's. The flow would have tapped whichever node the hierarchy listed first
and then asserted that a dashboard was on screen: the WRONG workspace,
silently proving nothing. The selectors are now each row's full
accessibility label — `"<client>, <entity>, <role>"` — which names exactly
one row. Verified against the captured hierarchy, and the passing run's
screenshot shows Harbor Light Bakery LLC (Synthetic) on Home with both
synthetic cases newest-first.

`maestro:validate` cannot catch this class today: it proves `id:` selectors
resolve to real testIDs, but a text selector's regex is never compared with
anything the app renders. A rule rejecting an unescaped `(` in a text
selector would have caught all five, and is proposed rather than written.

### Find 14 (P0) — the install marker is never written on device, so every launch signs the user out

With the selector fixed, `sign-in.yaml` passed. Every flow whose pre-step is
"signed in as client.owner with the Bakery workspace selected" then failed
on its first assertion, with the app sitting on the sign-in screen.
Reproduced with no Maestro involved: sign in, `adb shell am force-stop`,
`am start` — signed out.

Measured on device, which is what makes this a diagnosis rather than a
theory:

| Observation                                                    | Meaning                                                |
| -------------------------------------------------------------- | ------------------------------------------------------ |
| `shared_prefs/SecureStore.xml` is **3898 bytes** after sign-in | The session persisted: manifest + two encrypted chunks |
| The same file is **65 bytes** (`<map />`) after one relaunch   | `scrubAll()` ran during boot and deleted every key     |
| `files/` never contains `hive-install-marker.json`             | The install marker is never written                    |

Those three facts are the whole failure. `AuthController.boot()` treats
`residue && !markerExists` as "reinstall over a stale Keychain" and purges
before any auth evaluation. With the marker permanently absent, EVERY boot
takes that branch, so the session is destroyed on every launch and no one
can stay signed in. The chunked SecureStore adapter itself is vindicated:
its two-phase commit worked correctly on real hardware on the first attempt.

**Why the marker write fails.** `InstallMarker.ensure()` builds the id with
`newOpaqueToken(16, cryptoRandomSource)`, and `cryptoRandomSource.fill`
throws `Secure random source unavailable` unless
`globalThis.crypto.getRandomValues` exists. Hermes and React Native do not
provide it, and nothing in this dependency tree installs it: there is no
`expo-crypto`, no `react-native-get-random-values`, no `getRandomValues`
anywhere in the `expo` package (its winter runtime polyfills AbortSignal,
DOMException, FormData, TextDecoder, URL and fetch — not crypto), and no
`globalThis.crypto =` assignment in expo, react-native, expo-modules-core,
or @supabase. Recorded precisely: the throw itself was NOT observed, because
`boot()` wraps `marker.ensure()` in an empty `catch {}`. The absent random
source is the only candidate that throws before `store.write` is reached,
and it explains a marker file that never appears; expo-file-system's Android
`write` creates a missing file itself (`FileSystemFile.kt`:
`if (!exists) create()`), so the file binding is unlikely to be the failing
call. Confirming which line throws needs a diagnostic in that catch and a
rebuild.

**Why no lane caught it.** Every `InstallMarker` test injects `fixedRandom`,
and the live-bridge lane swaps both native byte stores for in-memory
synthetics. `cryptoRandomSource` and `documentMarkerFileStore` — the two
real bindings — have never executed in any lane, in any container, until
this run. 369 jest tests, 157 black-box assertions and 7 live-bridge
journeys all pass over a session that persists, because in every one of them
it does.

**Severity.** Availability, not confinement: the control fails CLOSED, so
nothing leaks — it destroys the session rather than trusting it. But the
product is unusable (sign in on every launch), and the reinstall-scrub
control now fires constantly instead of on reinstall, so it can no longer
evidence the thing it exists to evidence. `reinstall.yaml` passes and cannot
detect this, because a cleared install and a broken marker look identical at
boot.

**Not fixed here.** The fix adds a working random source to the auth boot
path — `expo-crypto` is the Expo-official answer, and it is a new native
dependency plus a prebuild and a full Gradle rebuild, in a security path.
The empty `catch {}` must also stop swallowing the failure, which is the
reason a P0 sat undetected behind six green lanes. Both are Kody's call.

### The 17-flow tally, as executed

Run individually in dependency order rather than as `maestro test .maestro`:
a directory run executes alphabetically with no state orchestration
(sign-in would run 16th), it includes `confinement-probe.yaml` which is
DESIGNED to fail, and it would run the enrollment pair outside the runner
that this repo makes mandatory for QR/setup-key artifact confinement.

| Flow                         | Result                                                                      |
| ---------------------------- | --------------------------------------------------------------------------- |
| `sign-in.yaml`               | **PASS** — OTP from Mailpit mid-flow, chooser, Bakery workspace, Home       |
| `accessibility-smoke.yaml`   | **PASS** (assertions only; a TalkBack pass is still outstanding)            |
| `reinstall.yaml`             | **PASS** — but see find 14: it cannot detect the marker defect              |
| `clipboard-scrub.yaml`       | **PASS**                                                                    |
| `activity-and-help.yaml`     | FAIL — find 14                                                              |
| `requests.yaml`              | FAIL — find 14                                                              |
| `nav-persistence.yaml`       | FAIL — find 14                                                              |
| `sign-out.yaml`              | FAIL — find 14                                                              |
| `scope-switch.yaml`          | FAIL — find 14 (selectors fixed, never reached)                             |
| `offline.yaml`               | FAIL — find 14 (selector fixed, never reached; airplane mode never toggled) |
| `read-surfaces-offline.yaml` | FAIL — find 14                                                              |
| `read-surfaces-denied.yaml`  | FAIL — find 14 (its operator revoke step was never reached)                 |
| `expired-session.yaml`       | FAIL — find 14; passed `assertNotVisible: Home` for the wrong reason        |
| `quarantine-recovery.yaml`   | FAIL — find 14; also needs a QA build (`EXPO_PUBLIC_QA_HOOKS=1`)            |
| `mfa-enroll.yaml`            | **HOLD** — runner refuses, toolchain pin unfilled                           |
| `mfa-login.yaml`             | **HOLD** — same                                                             |
| `confinement-probe.yaml`     | **HOLD** — same                                                             |

**4 PASS, 10 FAIL on one root cause, 3 HOLD.**

The three HOLDs are the designed fail-closed state, not a breakage:
`npm run maestro:enroll` exits 3 because `security/hardware-toolchain.json`
still carries `status: "HOLD-operator-fill"` with null version, artifactUrl,
sha256 and verifiedBy. That record attests to a download whose provenance
this session cannot establish, so it stays with Kody or the QA lead: record
the official release URL for Maestro 2.10.0 and its sha256, set status
`pinned`, name the verifier, then re-run `maestro:validate`.

**Environment notes for the runbook.** The lane needs the stack reachable at
`10.0.2.2:54321` from inside the emulator (it was, throughout), and a
cold-booted AVD — a snapshot-resumed emulator produced repeated
`DeviceServerDiedException` / `device offline` driver deaths that a cold
boot ended completely.

### Find 14 fixed, and verified on the device that found it

Kody authorized the fix on 2026-09-03. Three changes, smallest first:

- **`src/auth/native-random-source.ts`** (new) binds `expo-crypto` 57.0.2,
  pinned exactly like every other dependency, and `app-runtime.ts` injects
  it into `InstallMarker`. Core keeps its web-crypto source — it is shared
  with the Node script lanes, where `globalThis.crypto` is real — so the
  device binding sits beside the SecureStore and marker-file bindings
  rather than inside core.
- **`InstallMarker`'s `random` parameter is now REQUIRED.** It defaulted to
  the web-crypto source, so the one caller that mattered silently got a
  source that could not work. Every construction site now names what it
  uses, including the live lane, which says in place that it uses the Node
  source because it cannot load the device binding — which is exactly the
  seam find 14 lived in.
- **`boot()` no longer swallows the failure.** The empty `catch {}` records
  `install_marker_failed` (a new allowlisted diagnostic name). Boot still
  continues, because a marker is not a session, but an unwritable marker
  can never again be invisible.

**Proven on device, not inferred.** After a clean install and one
`sign-in.yaml`, `files/hive-install-marker.json` exists and holds
`{"v":1,"installId":"<32 hex>","createdAt":…}` — 16 bytes of real
randomness, which is the diagnosis confirming itself: the write had never
been reached because the RANDOM SOURCE threw, not because the file binding
failed. `am force-stop` then `am start` now restores the session instead of
purging it.

Red-checked first, per ENGINEERING METHOD: the new controller test
(`records a diagnostic when the marker cannot be written`) failed with
`Received array: ["auth_transition"]` before the change and passes after.
A second test pins the Hermes condition itself — `newOpaqueToken()` throws
`Secure random source unavailable` when `globalThis.crypto` is removed —
next to the pre-existing "uses the platform secure random source by
default" case, which passes under Node and was precisely the false comfort.

### Five more finds, all from running the lane rather than reading it

**Find 15 — `verify:toolchain` reported two matching tools as missing.**
On Windows npm and npx are `.cmd` batch wrappers that CreateProcess cannot
execute, so `execFileSync` threw ENOENT and the gate printed
`FAIL npm (packageManager): expected 10.9.8, found missing` on a machine
running exactly 10.9.8, and the same for the Supabase CLI at exactly
2.115.0. The same Windows trap as find 2. `shell` on win32, justified as
before by every command and argument being a hardcoded literal.
**verify:toolchain OK.**

**Find 16 — nine flows assumed a selected workspace survives a relaunch.**
Once sessions persisted, every "already signed in" flow still failed: the
app resumes to the CHOOSER, not to the last workspace. That is correct.
`docs/data-classification.md` puts Actor, ScopeKey and memberships in
Memory and names "persisted copies" as the thing that must not exist, so a
resumed session deliberately re-asks which workspace. The flows encoded an
assumption the data classification forbids; they now re-select the
workspace after `launchApp`, which also makes each one prove the session
survived the relaunch.

**Find 17 — the flows had no scroll vocabulary at all.** `activity-and-help`
asserts Help's content-version line, which is the last element on a screen
taller than the viewport: `help-version` was absent from the hierarchy
entirely, with `help-section-contact` clipped exactly at the 2400px screen
bottom. `assertVisible` sees the viewport, not the document, so the
assertion could never have passed on a phone. `scrollUntilVisible` is now a
known command with a payload schema (element required, direction
constrained, numerics checked) and nested testIDs still cross-checked by
the existing selector walk. Red-checked: four new tests, all failing
before.

**Find 18 (OPEN, product defect) — the nav is not persistent.**
`AuthorizedScreen` renders `PrimaryNav` INSIDE the scrolling `Screen`, as a
sibling of the children. On any destination whose content exceeds the
viewport the nav scrolls out of view — on Help, at default text size, on a
stock Pixel 8, the nav is not on screen at all. `nav-persistence.yaml`
fails on `nav-home`, which is the flow doing exactly the job it was written
for: the plan's own words are that a destination which drops the nav
"would strand the reader with only a system back gesture, which is not a
persistent label and is not discoverable with a screen reader". CLAUDE.md
requires persistent labels and 200% text, and at 200% every screen becomes
a long screen. The jest screen-level accessibility suite cannot see this —
it renders without a viewport, so nothing is ever below a fold. The fix is
to lift `PrimaryNav` out of the ScrollView into a pinned footer, which
moves safe-area padding and the tablet max-width with it; that is shared
chrome and a visual change, so it is left for Kody and Stacie rather than
taken here.

**Find 19 (OPEN, product defect) — system back from Account leaves the app,
and an assertion hid it.** `offline.yaml` failed tapping `nav-account` with
the ANDROID LAUNCHER on screen. Reproduced with a minimal probe using a
testID instead of a word: sign in, open Account, press back — the app
exits to the home screen instead of returning to the dashboard. CLAUDE.md
requires safe back/cancel. No crash appears in logcat; the routing cause is
not yet established.

It stayed hidden because **`assertVisible: 'Home'` matches the Android
launcher.** The launcher's workspace carries `accessibilityText` of exactly
"Home", and Maestro matches accessibility text as well as text, so the
flow's `- assertVisible: 'Home'` after `back` passed against the device
home screen with the app closed. That assertion appears in most flows as
the "we are on the dashboard" check, and it can pass with the app not
running. The dashboard has a testID (`dashboard-workspace`) that cannot be
confused with anything; the word should be replaced by it. Recorded rather
than changed, because it touches most flows and belongs with the find 18
decision.

**Find 20 — `expired-session.yaml`'s pre-step does not produce the state it
assumes.** Its header revokes the account's sessions server-side and
expects the next launch to fail closed with the expired notice. Deleting
every `auth.sessions` and `auth.refresh_tokens` row for the account (the
admin `/logout` endpoint answers 404 on this GoTrue) left the app still
reaching the workspace chooser: the STORED ACCESS TOKEN is a JWT, PostgREST
validates it statelessly and never consults `auth.sessions`, so a revoked
session keeps reading until that token expires — an hour, at the local
stack's default. That is Supabase's documented model rather than an app
defect, and the app's own boot-time expiry check is separately covered by
unit tests. The flow needs a pre-step that makes the STORED TOKEN unusable
— a short `jwt_expiry` on the local stack, or corrupting the stored token
through a QA hook — not a session revocation. Not executed; HOLD.

**Find 21 — `read-surfaces-denied.yaml` cannot be run as authored.** Its
header names `node scripts/local-supabase.mjs seed --revoke <email>
<entity>`; that command does not exist (`local-supabase.mjs` offers
`up|status|seed|e2e|reset-totp|stop`). Worse, the revocation has to land
between "the requests list is on screen" and the refresh tap, and the flow
offers no synchronization point for it. Driven from a watcher on Maestro's
own output, the delete (confirmed `DELETE 1`) still landed after the
refresh request went out, so the reload returned rows and the stale state
never appeared. The fix is the pattern this repo already uses for the OTP:
a loopback `runScript` helper that performs the revoke mid-flow, the way
`otp-fetch.js` reads Mailpit. Not executed; HOLD.

### The 17-flow tally after the fixes — supersedes the table above

| Flow                         | Result                                                                        |
| ---------------------------- | ----------------------------------------------------------------------------- |
| `sign-in.yaml`               | **PASS**                                                                      |
| `requests.yaml`              | **PASS** — list, detail, cross-scope rows absent, no write control            |
| `activity-and-help.yaml`     | **PASS** — roles not people; Help renders with the network off                |
| `read-surfaces-offline.yaml` | **PASS** — offline REPLACES content, then recovers                            |
| `scope-switch.yaml`          | **PASS** — and its two leak assertions are real now (find 13)                 |
| `sign-out.yaml`              | **PASS** — protected UI gone, and gone after relaunch                         |
| `reinstall.yaml`             | **PASS**                                                                      |
| `accessibility-smoke.yaml`   | **PASS** (assertions only; a TalkBack pass is still outstanding)              |
| `clipboard-scrub.yaml`       | **PASS**                                                                      |
| `nav-persistence.yaml`       | **FAIL — find 18**, a real product defect, correctly caught                   |
| `offline.yaml`               | **FAIL — find 19**, a real product defect, correctly caught                   |
| `expired-session.yaml`       | HOLD — find 20, the pre-step cannot produce the state                         |
| `read-surfaces-denied.yaml`  | HOLD — find 21, no mid-flow revoke helper exists                              |
| `quarantine-recovery.yaml`   | HOLD — needs a QA build (`EXPO_PUBLIC_QA_HOOKS=1`); this is a plain dev build |
| `mfa-enroll.yaml`            | HOLD — the Maestro toolchain pin is unfilled                                  |
| `mfa-login.yaml`             | HOLD — same                                                                   |
| `confinement-probe.yaml`     | HOLD — same                                                                   |

**9 PASS, 2 FAIL on genuine product defects, 6 HOLD** (was 4 / 10 / 3
before the fixes). Both failures are the lane earning its keep: neither
defect is reachable from any container, and one of them —
`nav-persistence` — is the flow that exists specifically to catch it.

Gates at this commit: typecheck exit 0, eslint `--max-warnings 0` clean,
jest **379 passed / 30 suites**, node:test **318 tests, 286 passed**,
`maestro:validate` OK across 17 flows, `verify:toolchain` OK. The 32
node:test failures are PRE-EXISTING on this desktop and unrelated: a clean
`git stash` of every change in this entry reproduces exactly 278/310 with
the same 32 names (audit-gate and export lanes, which need registry access
and a full `expo export`). All eight tests added here pass.

**Local stack note.** Driving find 21 by hand left `client.owner` outside
the canonical shape, and `seed` refused it — find 8's guard working. The
documented recovery (`npx supabase db reset`, then seed) restored **9
users, 15 memberships, all ids canonical**, and the lane was re-verified
green afterwards.

### Next, in priority order

1. **Find 18 and find 19** — two open product defects, owner Kody with
   Stacie on the nav's client experience. Both are UX requirements the
   brief already states (persistent labels, safe back), so the decision is
   how to implement, not whether.
2. **Replace `assertVisible: 'Home'` with the `dashboard-workspace`
   testID** across the flows, once (1) is settled — an assertion that
   passes against the Android home screen is not an assertion.
3. **Fill the Maestro pin** in `security/hardware-toolchain.json` to
   release the three enrollment/confinement flows.
4. **A mid-flow revoke helper** for `read-surfaces-denied`, and a
   stored-token pre-step for `expired-session`.
5. **A QA build** (`EXPO_PUBLIC_QA_HOOKS=1`) for `quarantine-recovery`.

## 2026-09-03, later — both open defects fixed; the lane reaches 11 of 17

Kody delegated the engineering calls after the first Phase 6 report. Finds
18 and 19 were fixed, three more finds came out of fixing them, and the
Maestro lane now passes twelve flows including both offline ones.

### Find 19 fixed — Android back was handed to an API nothing implements

`app.json` carried `"predictiveBackGestureEnabled": true`, which sets
`android:enableOnBackInvokedCallback="true"` and routes the back gesture to
Android's predictive-back `OnBackInvokedCallback` API. Nothing in this app
registers such a callback, so the system finished the Activity instead of
dispatching: back from ANY destination exited the app, and JS never
received `hardwareBackPress` at all.

The diagnosis was made on the device rather than from the flow output,
because the flow output was misleading (see find 22). A temporary probe
logged the router's own state — `["dashboard","requests/index"]`, index 1,
so the history was correct and two deep — while a `BackHandler` listener
logged nothing, and a raw `adb shell input keyevent 4` with no Maestro
anywhere still dropped the app to the launcher. Stack correct, JS never
notified: that is the Activity finishing above React Native, not a
navigator bug.

`predictiveBackGestureEnabled` is now `false`, which is Expo's own default,
and `config:check` fails if it is ever set back to `true` without predictive
back actually being implemented — red-checked before the rule went in.
Verified on device after the rebuild: back from Account and back from
Requests both return to the dashboard.

### Find 18 fixed — the nav is pinned chrome now

`AuthorizedScreen` rendered `PrimaryNav` inside the scrolling `Screen`, so
it scrolled away on any long screen. `Screen` gained a `footer` slot that
renders outside the ScrollView, owns the bottom safe-area inset (the
content no longer reserves it twice), and keeps the 720px readable measure
so the bar lines up with what it navigates. `PrimaryNav` lost its
`marginTop`, which only made sense when it followed content.

Guarded by a structural test rather than a visual one, because a renderer
has no viewport and can never see clipping: the shell test asserts the five
destinations are NOT descendants of the scroll area while the content IS.
Red-checked by putting the nav back inside the ScrollView — the new test
failed and **all four pre-existing shell tests still passed**, which is the
clearest statement of why this defect survived until a device ran it.
Verified on Help, the tallest screen: all five destinations visible with
content scrolling above them.

### Find 22 — the flows asserted screen identity with words the nav also uses

`assertVisible: 'Home'` matched the Android launcher (find 19's hiding
place). The same flaw ran through every destination: `'Requests'`,
`'Activity'`, `'Help'` and `'Account'` are all nav BUTTON labels, and the
nav is present on every authorized screen — so `assertVisible: 'Help'` is
satisfied while standing on Activity.

That is not hypothetical: it happened. `activity-and-help` reported
`Tap on id: nav-help... COMPLETED` and `Assert that "Help" is visible...
COMPLETED`, and the captured hierarchy for the NEXT step is the Activity
screen, nav and all. The tap had not navigated and the assertion said it
had. Every such assertion is now the screen's own testID —
`dashboard-workspace`, `requests-screen`, `activity-screen`, `help-screen`,
`settings-screen` — 30 replacements across 14 flows. The failure then
became honest, which is what exposed find 23.

### Find 23 — LogBox draws over the nav, and the offline flows provoke it

With sound assertions, `activity-and-help` failed reaching Help _while
airplane mode was on_. React Native's LogBox renders its "open debugger to
view warnings" banner across the BOTTOM of the screen — where the nav now
lives — and going offline produces a warning by design. The banner
swallowed the nav tap.

The Maestro lane therefore runs on the **QA build**
(`EXPO_PUBLIC_QA_HOOKS=1`), which now also suppresses the LogBox OVERLAY
only: warnings still reach the console and logcat, so nothing is silenced,
and the call sits behind the same `__DEV__` + QA-flag guard as the storage
hook — forbidden outside development by `config:check` and proven absent
from non-development exports by `bundle:inspect`. Attribution, stated
honestly: the assertion fix and the QA build landed close together. The
assertion fix is what made the failure legible; the banner covering the nav
is the inferred cause of the tap itself failing, supported by a screenshot
showing the banner over the nav with only the current-tab underline
visible beneath it.

### Find 24 — the QA storage hook cannot fire, because the router claims the URL

`quarantine-recovery.yaml` was HOLD for want of a QA build. With one built,
it got further and failed for a better reason: `hivedev://qa/corrupt-storage`
is intercepted by **Expo Router**, which treats it as the route
`/qa/corrupt-storage`, finds nothing, and renders its "Unmatched Route"
screen. The app's own `Linking` listener never gets to run the corruption,
so the acknowledgment never appears.

The hook was authored where it could never be exercised. The fix is a
design question rather than a typo: a router-native QA route would fire
reliably but must not exist in a release bundle, where `expo export`'s route
count and `bundle:inspect` both have opinions. Left HOLD with the cause
now precisely known instead of merely "needs a QA build".

### The tally: 11 PASS, 0 FAIL, 6 HOLD

| Flow                         | Result                                                   |
| ---------------------------- | -------------------------------------------------------- |
| `sign-in.yaml`               | **PASS**                                                 |
| `requests.yaml`              | **PASS**                                                 |
| `activity-and-help.yaml`     | **PASS** — including Help rendering with the network off |
| `nav-persistence.yaml`       | **PASS** — the find-18 fix, proven on the device         |
| `read-surfaces-offline.yaml` | **PASS**                                                 |
| `scope-switch.yaml`          | **PASS** — with the leak assertions real (find 13)       |
| `offline.yaml`               | **PASS** — the find-19 fix, proven on the device         |
| `sign-out.yaml`              | **PASS**                                                 |
| `reinstall.yaml`             | **PASS**                                                 |
| `accessibility-smoke.yaml`   | **PASS** (assertions only; TalkBack still outstanding)   |
| `clipboard-scrub.yaml`       | **PASS**                                                 |
| `quarantine-recovery.yaml`   | HOLD — find 24                                           |
| `expired-session.yaml`       | HOLD — find 20, the pre-step cannot produce the state    |
| `read-surfaces-denied.yaml`  | HOLD — find 21, no mid-flow revoke helper exists         |
| `mfa-enroll.yaml`            | HOLD — the Maestro toolchain pin is unfilled             |
| `mfa-login.yaml`             | HOLD — same                                              |
| `confinement-probe.yaml`     | HOLD — same                                              |

Eleven ran back to back in one sweep with no failures; `quarantine-recovery`
was attempted separately and produced find 24. **Nothing now fails.** The
six HOLDs are three kinds of missing thing — an operator attestation, two
harness helpers, and one hook design — not defects in the app.

Gates at this commit: typecheck exit 0, eslint `--max-warnings 0` clean,
prettier clean, jest **380 passed / 30 suites**, node:test **320 tests, 288
passed** (the same 32 pre-existing desktop failures, unchanged and
unrelated), `maestro:validate` OK across 17 flows, `config:check` OK,
`verify:toolchain` OK.

### Runbook notes earned the hard way

- **The lane needs Metro up, and `expo run:android` leaves a wedged node
  process holding port 8081 after it exits.** Twice the next `expo start`
  refused the port and skipped the dev server, and every launch then hit
  "Unable to load script". Free the port before starting Metro.
- **A flow that fails mid-way can leave airplane mode ON**, which breaks
  the next flow's bundle fetch and looks like an unrelated failure. The
  sweep disables it between flows.
- **The Maestro lane runs on the QA build** (`EXPO_PUBLIC_QA_HOOKS=1`), for
  the LogBox reason above.

### Next

1. **Fill the Maestro pin** in `security/hardware-toolchain.json` — official
   2.10.0 release URL, sha256, status `pinned`, and a named verifier. Owner
   Kody; it is an attestation, so it cannot be delegated. Unblocks three
   flows.
2. **Find 24** — a QA corruption hook that survives Expo Router without
   shipping a route in release.
3. **Find 20 / find 21** — a stored-token pre-step and a loopback mid-flow
   revoke helper, both modelled on `otp-fetch.js`.
4. **TalkBack pass** on `accessibility-smoke`, and measured contrast on
   hardware. Still the only part of A4 that hardware can settle.

## 2026-09-04 — the Maestro pin verified to the edge of a signature, and a correction

### The pin: everything mechanical is done and checked

`security/hardware-toolchain.json` sat at `HOLD-operator-fill` with four
null fields. Three of them are now filled, and filled by verification
rather than transcription:

1. `checksums_sha256.txt` was fetched from the official `cli-2.10.0`
   release and publishes `29b675e1…cd991` for `maestro.zip`.
2. `maestro.zip` (314,828,521 bytes) was downloaded from the official
   release URL and its sha256 **computed locally**. It equals the published
   value. The digest in the record is that computed number.
3. The release was extracted and compared with the CLI already installed at
   `%LOCALAPPDATA%\Programs\maestro`: **198 files in the release, 198 in
   the install, 0 missing, 0 content mismatches** by sha256. The Maestro
   that runs these flows is byte-identical to the official artifact — which
   is the question a recorded digest cannot answer by itself, since the
   runner never recomputes it.

Status is `verified-pending-attestation`, deliberately not `pinned`. What
is left is a person putting their name to it, which is the one thing here
that cannot be delegated: a checksum says the binary is what the vendor
published, not that anyone accepts responsibility for running it. The
runner now reports exactly two problems, both of that kind:

```
HOLD the Maestro CLI is not pinned (status "verified-pending-attestation")
HOLD the Maestro pin records no verifier
```

The negative test that guards this was updated rather than left to rot: it
used to assert the live record fails for "no sha256", which is no longer
true. It now asserts the record still fails, names the reasons that
actually apply, and additionally requires that whatever digest the record
carries is a real 64-hex value and never a placeholder.

### Find 25 — the enrollment runner could not launch Maestro on Windows

Filling the pin exposed the next layer. The runner reported "the installed
Maestro CLI (unknown) is not the pinned version 2.10.0" on a machine where
`maestro --version` prints `2.10.0`. Windows ships the CLI as
`maestro.bat`, which CreateProcess cannot execute, so all four spawns died
at ENOENT: `--version` read empty (reported as "unknown"), `test --help`
read empty (which `outputFlagProblems` reports as the CLI not supporting
`--debug-output`, i.e. an unconfinable run), and neither the clipboard
scrub nor a flow could have run at all. The runner was non-functional on
the only machine that owns the device lane, and every symptom pointed
somewhere else.

Fixed with `maestroCommand`/`lookupMaestroCommand`, unit-tested including
the case that matters: arguments stay an **argv array** rather than a
shell string, because they carry generated temp paths and a run root with
a space would otherwise split — confining QR-bearing screenshots to the
wrong directory, the single failure this runner exists to prevent. The
version-mismatch line is gone; the two attestation lines remain.

### Find 26 — a test asserted a POSIX path separator

`maestroArgs` builds its flow path with `path.join`, so on Windows it ends
`.maestro\mfa-enroll.yaml`; the test asserted the literal
`.maestro/mfa-enroll.yaml`. Now asserted with `path.join`.

### Find 27 — the same Windows trap in the audit and export gates

`audit:gate` reported `could not spawn npm (ENOENT)` and the export lane
`spawnSync npx ENOENT`. Same cause a fourth and fifth time: npm and npx are
`.cmd` wrappers. Both now route through `scripts/lib/node-cli.mjs`, a
single shared helper that documents the two survival strategies and why the
choice is not stylistic — `shell: true` re-parses one command string and is
safe only for hardcoded literals (which is why local-supabase and
verify-toolchain use it), while an argv array preserves per-argument
quoting and is required wherever a generated path appears.

Proven live rather than by unit test: `npm` and `npx` both spawn and return
their versions through the helper, and a path containing a space survives
as one argument. `npm run audit:gate` now reaches the real registry instead
of dying at spawn — and today fails closed on a genuine upstream outage
(`503 Service Unavailable` from the npm audit endpoint), which is the gate
behaving correctly, not a regression. `export:candidate` now reaches its
own configuration check and refuses because the device lane's `.env.local`
carries the emulator origin `10.0.2.2`, approved for development only —
also correct.

### A correction to the previous two entries

Those entries said the 32 failing node:test cases on this desktop were
"pre-existing and unrelated — audit-gate and export lanes, which need
registry access and a full `expo export`". **That was wrong**, and it was
an inference from test names rather than a diagnosis. The real causes were
two, and one of them was a live defect:

- the gates themselves were broken on Windows (find 27), which is fixed;
- the two integration files drive those gates through a `#!/bin/sh` fake
  executable found on a `":"`-joined PATH. Windows can run neither. Those
  files are POSIX-only by construction and were never going to pass here.

The clean-tree baseline I cited (278/310) was accurate as a measurement;
the explanation attached to it was not. Recorded because a wrong
explanation for a red test is worse than no explanation — it is what let
thirty-one failures sit unexamined across two reports.

Both files now SKIP on win32 with the reason stated, following the same
reasoning that makes `preflight:device` report BLOCKED rather than a
finding: permanent red trains people to ignore red. They are not disabled —
they run in full on POSIX, where CI and the container lane execute them.
Making the fakes cross-platform is follow-up, not done here.

### Gates on this desktop, all green

| Lane                      | Result                                                           |
| ------------------------- | ---------------------------------------------------------------- |
| typecheck                 | exit 0                                                           |
| eslint `--max-warnings 0` | clean                                                            |
| prettier                  | clean                                                            |
| jest                      | **380 passed**, 30 suites                                        |
| node:test                 | **324 tests, 290 passed, 0 failed, 34 platform-skipped**         |
| maestro:validate          | OK — 17 flows, 4 helper scripts                                  |
| config:check              | OK (development)                                                 |
| verify:toolchain          | OK                                                               |
| audit:gate                | ENGINE FAILURE — npm audit endpoint returning 503 upstream today |
| export:candidate          | refuses: the device lane's emulator origin is development-only   |
| Maestro flows             | 11 PASS, 0 FAIL, 6 HOLD (unchanged from yesterday)               |

The node:test suite went from 31 failures to zero without a single
assertion being weakened: one was a real Windows defect in the runner, one
was a POSIX-only path assertion, and the rest were a harness that cannot
execute on this platform and now says so.

### Still outstanding, unchanged

The Maestro pin's signature (Kody), find 24's hook design, find 20's
stored-token pre-step, find 21's mid-flow revoke helper, and the TalkBack
pass. Nothing new was added to that list today.

## 2026-09-04 — the pin signed, and the enrollment lane opened far enough to find five more defects

Kody Rogers signed the Maestro pin on 2026-09-04 ("Verifier: Kody Rogers.
Yes, pin it."), accepting the three recorded checks. `status: pinned`, and
the runner stopped refusing. Everything below came out of that lane
actually running for the first time.

### Find 28 — the QR could never render, because GoTrue sends a whole SVG document

`mfa-enroll.yaml` failed on `mfa-enroll-qr`. `decodeSupabaseTotpQr`
accepted a `data:` URI or a bare `<svg>`; this GoTrue returns neither. It
returns an SVG DOCUMENT: an XML declaration, then a generator COMMENT,
then the root. The decoder returned null, the screen fell back to the
manual setup key exactly as designed, and the QR assertion failed.

Shape established by probing the live stack and printing STRUCTURE ONLY —
type, length, and a character-class mask — because the QR encodes the
secret. The first fix handled a declaration and a DOCTYPE and still
failed; the `<!` after the prolog was a comment, not a doctype, which a
masked dump does not distinguish. The decoder now strips a bounded prolog
of declarations, comments and doctypes in any order.

Tightened while there, not loosened: `<!ENTITY` anywhere is refused, and a
DOCTYPE carrying an internal subset — where entity declarations live — is
refused outright rather than sanitised, because this string is handed to a
renderer. Every existing refusal (script, foreignObject, javascript:,
`on*=` handlers) still holds, now also after a legitimate prolog.

### Find 29 / 34 — one flow was pretending to cover two identities

`sign-out.yaml` runs standalone for client.owner AND inside the enrollment
sequence for reviewer.rae. After find 16 gave it a workspace-chooser step,
it broke for staff: reviewer.rae holds ONE membership and resumes straight
to Home, so there is no chooser. Making the chooser step `optional` did not
work either, and the reason is worth recording: **`optional` does not
wait**. On a resumed session it skipped past the chooser before the app had
rendered it, then failed on the dashboard.

The flows are now split. `sign-out.yaml` is deterministic for client.owner
(bounded wait for the chooser, then select). New `staff-sign-out.yaml`
is deterministic for reviewer.rae (bounded wait for the dashboard), and the
runner's SEQUENCE names it. Two identities, two flows, no optional steps
standing in for a branch.

### Find 30 — the verify control sat under the keyboard

With the soft keyboard up (`adjustResize`) on the tall enrollment screen,
`mfa-submit` could not be tapped. Scrolling to it did not help either — the
keyboard covered it, so 100% visibility was unreachable. `hideKeyboard` is
now a validated command in the flow vocabulary and is used before both
verify taps, which is what a person does.

### Find 31 — a cold start is not instantaneous, and assertions raced it

A dev build fetches its bundle from Metro on a cold start, so the first
assertion after `launchApp` — especially after `clearState: true` — raced
the boot. Bounded `extendedWaitUntil` now guards the first element in
`mfa-enroll.yaml`, `reinstall.yaml`, `sign-out.yaml` and
`staff-sign-out.yaml`, and the post-verify dashboard assertion in both MFA
flows, which is a server round trip rather than an instant render.

### Find 32 — reinstall.yaml could pass because the app had not booted

Its two `assertNotVisible` checks ran immediately after `clearState: true`.
On the blank first frame both pass VACUOUSLY, so the flow's whole point —
a data-cleared install boots clean — could succeed for the worst possible
reason. The signed-out screen is now waited for FIRST; only then are the
negatives evaluated. Ordering is the fix, and it is the difference between
an assertion and a decoration.

### Find 33 (OPEN) — the QR makes the device lane too slow for TOTP

The enrollment flow now reaches the final verification and fails there.
GoTrue's own audit log gives the reason without guesswork:

| event              | time     |
| ------------------ | -------- |
| login              | 12:13:41 |
| factor_in_progress | 12:13:42 |
| challenge_created  | 12:16:00 |
| challenge_created  | 12:18:30 |

Two and a half minutes between steps. The QR is a 321,600-character SVG,
and every Maestro action on that screen requires a view-hierarchy dump. A
TOTP code fetched immediately before typing is therefore ~60 seconds old
when it submits — right at GoTrue's tolerance, which is exactly why this
flow passed once and then did not.

Hiding the QR's internals from the accessibility tree
(`importantForAccessibility="no-hide-descendants"` on an inner wrapper,
the labelled container unchanged) is a real improvement for a screen
reader — thousands of meaningless stops become one labelled image — but it
did NOT speed the lane up, so the cost is the native view tree rather than
the accessibility tree. Recorded as unresolved rather than dressed up: the
remaining work is to make that screen cheap to inspect, or to shorten the
path between fetching a code and submitting it.

`mfa-enroll.yaml` therefore still fails, and `staff-sign-out.yaml`,
`mfa-login.yaml` and `confinement-probe.yaml` are not reached. What DID
prove out, in a single clean run: staff OTP sign-in, the QR rendering, the
setup key, the handoff of that key to the loopback helper's memory, the
immediate clipboard overwrite, and a guaranteed-wrong code producing a
notice with the enrollment still on screen.

**The runner's confinement held throughout.** On every failure it
terminated the helper, overwrote the clipboard, revoked the disposable
factor, and removed and verified its artifact tree. Twice the clipboard
scrub itself failed and it said so LOUDLY rather than exiting quietly;
both times the clipboard was scrubbed manually afterwards and
`reset-totp` confirmed `0 deleted, readback verified zero`.

### The tally: 11 of 18

| Flow                         | Result                                                 |
| ---------------------------- | ------------------------------------------------------ |
| `sign-in.yaml`               | **PASS**                                               |
| `requests.yaml`              | **PASS**                                               |
| `activity-and-help.yaml`     | **PASS**                                               |
| `nav-persistence.yaml`       | **PASS**                                               |
| `read-surfaces-offline.yaml` | **PASS**                                               |
| `scope-switch.yaml`          | **PASS**                                               |
| `offline.yaml`               | **PASS**                                               |
| `sign-out.yaml`              | **PASS** (client path, after the split)                |
| `reinstall.yaml`             | **PASS** (and now for the right reason — find 32)      |
| `accessibility-smoke.yaml`   | **PASS** (assertions only; TalkBack still outstanding) |
| `clipboard-scrub.yaml`       | **PASS**                                               |
| `mfa-enroll.yaml`            | FAIL — find 33, device-lane timing on the QR screen    |
| `staff-sign-out.yaml`        | not reached (sequence stops at enrollment)             |
| `mfa-login.yaml`             | not reached                                            |
| `confinement-probe.yaml`     | not run                                                |
| `quarantine-recovery.yaml`   | HOLD — find 24                                         |
| `expired-session.yaml`       | HOLD — find 20                                         |
| `read-surfaces-denied.yaml`  | HOLD — find 21                                         |

Eleven ran back to back in one sweep with no failures. The count is 11 of
18 rather than 11 of 17 because splitting the sign-out flow added one.

### A runbook note that cost several runs to learn

**Warm the app before each flow.** `adb shell am start`, wait ~8s, then
`am force-stop`. Without it the first assertion after `launchApp` races the
bundle fetch and flows fail in ways that look like logic errors: a batch
that failed 6/6 passed 6/6 with a warm-up and no other change. The bounded
waits added above cover the flows that clear state; the warm-up covers the
rest until every flow has one.

### Gates

typecheck exit 0 · eslint `--max-warnings 0` clean · prettier clean · jest
**391 passed / 30 suites** · node:test **325 tests, 291 passed, 0 failed,
34 platform-skipped** · maestro:validate OK across **18 flows** ·
config:check OK · verify:toolchain OK.

### Next

1. **Find 33** — make the enrollment screen cheap enough to drive, or
   shorten the fetch-to-submit path. It is the only thing between here and
   four more passing flows.
2. **Find 24** — a QA corruption hook Expo Router does not claim.
3. **Find 20 / 21** — the stored-token pre-step and the mid-flow revoke
   helper.
4. **TalkBack**, and measured contrast on hardware.

## 2026-09-04, later — find 24 closed; quarantine recovery proven on hardware

### The system killed Metro, and the reason was mine

A background notification reported Metro stopped for low memory. Three
orphaned Expo processes from earlier runs in this session were holding
~1.5 GB between them — `expo run:android` and two `expo start` instances
that outlived the tasks that spawned them. Killing them returned 1.6 GB.
Worth the runbook line: **these processes survive their parent**, and they
also hold port 8081, which is the same wedge that twice made `expo start`
refuse the port earlier.

### Find 24 fixed — a deep link the router does not claim

`hivedev://qa/corrupt-storage` was intercepted by Expo Router as the route
`/qa/corrupt-storage`, which does not exist: the router rendered
"Unmatched Route" and the app's own `Linking` listener never ran. The
obvious repair — a QA route — would put that route in the release bundle,
which `expo export`'s route count and `bundle:inspect` both have opinions
about, and which is the wrong trade for a test affordance.

The link now addresses the ROOT with a query:
`hivedev:///?qa=corrupt-storage`. The router resolves it to a route that
already exists and navigates normally, while `Linking` still delivers the
whole URL to the hook.

Exactness did not loosen in the move — it tightened. The matcher requires
the exact scheme, NO host, a root path, and **exactly one** query
parameter with exactly the expected value. The previous contract accepted
`hivedev://qa/corrupt-storage?x=1`, tolerating arbitrary extra parameters
alongside a trigger that corrupts stored session state; that is now
refused, along with a foreign scheme, any host, a trailing path, and a
longer value. Red-checked before the change.

### Find 35 — two flows asserted copy the app does not render

With the hook firing, `quarantine-recovery.yaml` reached its last
assertion and failed on
`'Secure sign-in data was reset. Sign in again to continue.'`. The screen
shows **"Note: Secure sign-in data was reset. Sign in again to continue."**
— the `Notice` primitive prefixes an info notice with "Note", deliberately,
because status is never conveyed by colour alone. A full-match text
assertion has to include what the screen renders. Both that flow and
`expired-session.yaml` carried the un-prefixed form; both now assert the
prefix, with the sentence periods escaped because Maestro matches text as
a regex.

### quarantine-recovery.yaml PASSES

End to end on the emulator: signed in, the QA link fires, the
acknowledgment appears, the app is stopped and relaunched, **no protected
UI**, the quarantine screen with "Secure sign-in data needs a reset",
**"Retry" correctly absent** — a generic retry must not reuse a retained
session — the scrub action taps, and the signed-out screen shows the
scrubbed notice. The one device flow that proves storage quarantine is
reachable and escapable now runs.

### The tally: 12 of 18

Unchanged from the previous entry except `quarantine-recovery.yaml`, which
moves from HOLD to **PASS**. Twelve pass, `mfa-enroll` fails on find 33,
`staff-sign-out` / `mfa-login` / `confinement-probe` are unreached behind
it, and `expired-session` (find 20) and `read-surfaces-denied` (find 21)
remain HOLD on missing harness pieces.

### Gates

typecheck exit 0 · eslint `--max-warnings 0` clean · prettier clean · jest
**396 passed / 30 suites** · node:test **325 tests, 291 passed, 0 failed,
34 platform-skipped** · maestro:validate OK across 18 flows · config:check
OK.

### Not pushed

Five commits sit local: `git push` was refused by the Claude Code auto-mode
permission classifier, not by any repository rule. It needs Kody to run the
push or to allow the action. Recorded because a day of device evidence
living on one desktop's disk is the risk it sounds like.

## 2026-09-04, evening — find 33 measured and fixed; the flow it blocks still fails

Kody freed the machine (19.6 GB available, up from 4.5), which made a real
device iteration loop possible for the first time today.

### The fix: one path per colour instead of 4,225 rects

Measured first rather than assumed. A live enrollment's `totp.qr_code` is
**321,600 characters containing 4,225 `<rect>` elements**, and the document
contains only two tag names, `svg` and `rect`. react-native-svg turns each
rect into its own native view, so the enrollment screen carried thousands
of them and every Maestro view-hierarchy dump on it crawled.

`flattenQrSvg` collapses those rects into ONE `<path>` per fill colour.
The geometry is preserved exactly — every module still drawn, same
coordinates, same colours — expressed as path data instead of elements.

It **fails safe**: a non-rect element, a coordinate that is not a plain
number, or a fill that is not a plain colour returns the input UNCHANGED
rather than a badly rewritten SVG. The fill is the one attribute copied
into the output, so only `#rgb`-style hex and bare colour words are
accepted; a crafted `fill="url(#x)&quot; onload=&quot;x()"` is refused.
Red-checked on all seven cases before the implementation existed.

**The measurement that matters**, from GoTrue's own audit log. Before, the
gap between `factor_in_progress` and the first `challenge_created` ran
~2.5 minutes. After, the run reached its failure point 49 seconds after
enrollment having completed nine steps — **about 5.5 seconds per step
against roughly 20 before, a ~4x improvement.** That is the finding closed:
the device lane on that screen is no longer slow enough to expire a TOTP
code between fetching it and submitting it.

It is also a real accessibility improvement independent of the lane: a
screen reader met thousands of meaningless module nodes and now meets one
labelled image.

### What it did NOT fix, stated plainly

`mfa-enroll.yaml` still fails, now at a different place: after
`hideKeyboard`, `mfa-submit` cannot be found — not by a tap, not by
`scrollUntilVisible` at 100% or 60% visibility, and not by a 15-second
`extendedWaitUntil`. The button is always rendered (it is merely
`disabled` while the field is empty), so "not visible" points at either the
typed code not landing or the control sitting outside the viewport in a way
scrolling does not resolve.

A last experiment — removing `hideKeyboard` on the theory that
`adjustResize` scrolls the focused field's button INTO view and dismissing
the keyboard scrolls it back out — could not be completed: the runner hung
after the Maestro process exited and had to be stopped. The flows are
therefore left with `hideKeyboard` restored, which is the configuration
that once reached the final assertion, and the experiment is recorded
rather than half-applied.

**Diagnosing this properly needs the enrollment screen's view hierarchy,
and that screen shows the QR and the setup key** — so it cannot be dumped
to `~/.maestro/tests` or to `/sdcard` the way any other screen could. The
next attempt should drive a probe through a confined output directory the
way `maestro-enroll-runner.mjs` does, inspect the hierarchy inside it, and
scrub it — not reach for `uiautomator dump`.

### Cleanup after the interrupted run, because it was interrupted

Stopping the runner mid-flight skipped part of its own cleanup. Verified by
hand afterwards: the loopback `totp-helper` was **still listening** and was
killed (in-memory secret discarded), `reset-totp` confirmed
`0 deleted, readback verified zero`, and the clipboard scrub — which had
reported FAILED — was re-run to completion. Recorded because the runner's
guarantees hold when it exits on its own and do not when something kills
it, which is worth knowing before anyone kills it again.

### State

| Lane                          | Result                                                                                                       |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Maestro                       | **12 of 18 pass**, unchanged; spot-checked sign-in, requests and quarantine-recovery green after this change |
| jest                          | **403 passed**, 30 suites (7 new for the flattener)                                                          |
| node:test                     | 325 tests, 291 passed, 0 failed, 34 platform-skipped                                                         |
| typecheck / eslint / prettier | exit 0 / clean / clean                                                                                       |
| maestro:validate              | OK across 18 flows                                                                                           |

### Next

1. **The `mfa-submit` visibility question** — with a confined-artifact
   probe, not a raw dump. Four flows sit behind it.
2. **Find 21 / find 20** — the mid-flow revoke helper and the stored-token
   pre-step.
3. **TalkBack**, and measured contrast on hardware.

## 2026-09-05 — the mfa-submit question answered, and it was never the button

### The probe, and why it had to be built rather than improvised

Diagnosing this needed the enrollment screen's view hierarchy, and that
screen shows the QR and the setup key — so it could not go to
`~/.maestro/tests`, and `uiautomator dump` would have written the setup key
to `/sdcard`. The probe therefore mirrors what
`scripts/maestro-enroll-runner.mjs` does: a private mode-0700 run root,
BOTH Maestro output flags pointed inside it, a deliberate failure on a
selector that cannot exist to force a hierarchy capture, extraction of only
the handful of fields under question, then removal and verification. No
value from that screen was printed — only presence, bounds, and enabled or
clickable state.

### The answer

| node            | bounds                 | enabled  | clickable                  |
| --------------- | ---------------------- | -------- | -------------------------- |
| `mfa-enroll-qr` | `[257,505][824,1072]`  | true     | false                      |
| `mfa-code`      | `[42,1673][1038,1801]` | true     | true (focused, holds text) |
| `mfa-submit`    | `[42,1863][1038,1989]` | **true** | **true**                   |

**Total nodes in the hierarchy: 63.** Before the QR flattening that same
screen was thousands.

So `mfa-submit` is present, enabled, clickable, and sits comfortably inside
a 2400px-tall screen with the keyboard dismissed and the code already in
the field. **The button was never the problem, and neither was
`hideKeyboard`, and neither was layout.** Three sessions of flow edits —
scroll steps, visibility percentages, bounded waits — were aimed at a
defect that did not exist.

What was actually wrong: the emulator. Before this probe would run at all,
Maestro failed with `MaestroDriverStartupException: Android driver did not
start up in time`, then with `device 'emulator-5554' not found` mid-flow.
The emulator had been up about eighteen hours under continuous device-lane
load. Uninstalling the two `dev.mobile.maestro` driver packages (which this
time reported `Success`, meaning stale copies really were installed),
restarting adb, and cold-booting the AVD cleared all of it — and the probe
then ran clean end to end on the first attempt.

**The correction that matters for anyone reading the earlier entries:** the
`mfa-submit` failures recorded on 2026-09-04 were environmental, not a UI
defect. The flow edits made in pursuit of them were aimed at the wrong
target. `hideKeyboard` is retained because dismissing the keyboard before
tapping is what a person does and it costs nothing; the scroll steps and
visibility tuning are gone.

### Find 36 (fixed 2026-09-06 — see that day's entry below) — the enrollment runner hangs on Windows, and fails OPEN when it does

Twice now, `npm run maestro:enroll` has stopped making progress with the
runner process alive, no Maestro child running, and no further output. The
second time it sat on a run root whose last write was minutes earlier.

The consequence is the serious part. This runner's entire purpose is
fail-closed cleanup, and a hang defeats it: killing the stuck process left
the loopback `totp-helper` **still listening with a setup secret in
memory**, a run root on disk, and the clipboard unscrubbed. Every one of
those had to be finished by hand — helper killed, `reset-totp` confirming
`0 deleted, readback verified zero`, `clipboard-scrub.yaml` re-run, run
root removed and verified gone.

A cleanup guarantee that holds only when the process exits normally is not
a guarantee. The runner needs to survive its own hang — a watchdog around
each flow invocation, and cleanup that runs on that path too. Recorded as
open; it is now the highest-priority item in this area, above the flows it
is supposed to run, because it is a fail-open in a control rather than a
missing test.

Suspicion worth checking first: the Windows change from find 25 routes
Maestro through `cmd.exe /c` under `spawnSync` with inherited stdio, which
is exactly the shape that can block on a handle after the child exits. It
may be self-inflicted.

### Runbook additions

- **An emulator up ~18 hours under device-lane load degrades**, and it
  presents as Maestro problems rather than emulator problems: driver
  startup timeouts and mid-flow `device not found`. Cold-boot the AVD and
  uninstall `dev.mobile.maestro` / `.maestro.test` before concluding
  anything about a flow.
- **The confined-probe pattern above is reusable** for any question about a
  secret-bearing screen. Use it instead of `uiautomator dump`.

### State

Unchanged at **12 of 18 flows**; `mfa-enroll` and the three behind it are
now blocked on find 36 rather than on anything in the app. Gates as at the
previous entry: jest 403, node:test 325 with 291 passed and 34
platform-skipped, typecheck 0, eslint and prettier clean,
maestro:validate OK across 18 flows.

## 2026-09-06 — find 36 fixed: the enrollment runner survives its own hang

Authored and gated in the build container (the device lane is HOLD here);
the desktop rerun is the verification step and closes this entry.

The hang itself was never reproduced here — there is no device lane to
reproduce it on — so the fix removes the vulnerable SHAPE rather than
claiming one exact wedge is proven. Every variant of the suspicion lands
in the same place: `runFlow` executed Maestro with `spawnSync` through
`cmd.exe /c` with inherited stdio, which (a) blocks the event loop, so the
SIGINT/SIGTERM handlers that guarantee cleanup cannot run while it is
stuck — killing the runner from outside was the only way out, and that
skips cleanup, which is exactly the residue the find recorded — and (b)
has no bound of its own, so anything wedged below it (`cmd.exe` waiting on
a straggler java or adb child, a blocked inherited handle) suspends the
runner forever.

What changed in `scripts/maestro-enroll-runner.mjs`:

1. **Every Maestro invocation is async `spawn`, settled on `exit` plus a
   1s stdio drain — never on `close` alone.** `close` additionally waits
   for the stdio streams, and a straggler grandchild holding an inherited
   pipe handle keeps them open forever. This is not just reasoning:
   reproduced in this container with a child that exits 7 leaving a
   backgrounded `sleep 600` holding the pipe — `exit` fired at +1ms,
   `close` never fired, and the drain path settled at +1002ms with the
   complete output. The event loop also stays free now, so Ctrl+C reaches
   the cleanup handlers mid-flow.
2. **A watchdog bounds every invocation** — flows default to 10 minutes
   (`HIVE_MAESTRO_FLOW_TIMEOUT_MS` overrides; garbage in that variable is
   an ENGINE FAILURE at startup, never a silent default), the
   `--version`/`--help` probes to 60s — and on expiry kills the whole
   process TREE: `taskkill /pid <pid> /T /F` on Windows (killing only
   `cmd.exe` would orphan the java process that owns the device), a
   `SIGKILL` to the detached process group on POSIX (verified here: the
   group kill left only a zombie awaiting the reaper, nothing running).
   The run then FAILS through the normal path, so cleanup runs on the
   watchdog path too.
3. **Cleanup itself is bounded.** The clipboard scrub and factor
   revocation keep `spawnSync` on purpose — cleanup can run inside
   `process.on('exit')`, where only synchronous work executes — but now
   carry `timeout` + `SIGKILL` (a straggler grandchild is accepted there
   over an unbounded hang holding the secret), and cleanup's first act is
   to tree-kill any Maestro invocation still in flight, so the scrub flow
   and the run-root removal are not blocked by the thing that just
   wedged.
4. **Startup fails CLOSED on the residue of a hand-killed run.** The
   helper port (127.0.0.1:8477) already in use is a HOLD naming the
   likely stale totp-helper — previously the new helper crashed on bind
   (totp-helper has no listen-error recovery), the runner logged that and
   CONTINUED, and the flows would then have talked to the stale helper:
   find 36's fail-open sibling. A helper that dies mid-run now fails the
   sequence before the next flow instead of being narrated past. Stale
   `hive-maestro-*` run roots in the tmpdir are swept loudly at startup.
5. Two corrections in passing: `chmod 700` on the run root is POSIX-only
   now (there is no chmod binary to call on Windows — the call can only
   ever have worked on the desktop because something shipped one on PATH —
   and `%TEMP%` is already ACL'd to the user), and the `where`/`which`
   lookup probe is bounded like everything else.

Tests: three added to `tests/scripts/maestro-runner.test.mjs` — the
tree-kill argv on both platforms (`/T` present, pid as one argv entry,
null on POSIX where the process group is signalled), the watchdog
default/override/fail-closed-on-garbage parsing, and the
`hive-maestro-` prefix contract shared by mkdtemp and the sweep.

Gates fresh this cycle (build container, Linux — the 34 win32 skips all
execute here): node:test 328 passed / 0 failed, jest 403 passed across 30
suites, typecheck 0, eslint and prettier clean, maestro:validate OK (18
flows, 4 helper scripts), and `maestro:enroll` itself smoke-run to its
designed container HOLD (exit 3, no Maestro binary).

### State

Still **12 of 18 flows**, but nothing is open in this area ahead of the
desktop rerun: `npm run maestro:enroll` on the API 35 lane is the
verification. Expected shape of that run: a port-8477 HOLD or a
stale-run-root sweep first if the hung run's residue is still on the
machine, then reset -> enroll -> sign-out -> login on the same factor ->
revoke, each flow under the watchdog. Success there and on
`npm run maestro:confinement` clears all four flows behind find 36
(`mfa-enroll`, `staff-sign-out`, `mfa-login`, `confinement-probe`) —
**16 of 18**, leaving only `expired-session` and `read-surfaces-denied`
on the finds-20/21 harness helpers.

## 2026-09-06, later — the deliberate SDK 57 patch refresh (cloud, task filed 2026-09-02)

Kody authorized autonomous forward motion and stepped out; this is the
filed patch-refresh, done from the build container with the full gate
sweep. The Expo API is egress-blocked here, so the authoritative target
set came from the npm registry itself: the latest SDK 57 patch of `expo`
is now **57.0.20** (it had already moved past the 57.0.18 the desktop saw
on 2026-09-02), and its own `bundledNativeModules.json` — fetched by
tarball, no Expo service involved — supplies the allowed range for every
governed package. Resolving each range to its newest satisfying version
produced exactly **twelve changes**, matching the desktop's count:

| package               | from    | to           |
| --------------------- | ------- | ------------ |
| expo                  | 57.0.11 | **57.0.20**  |
| expo-build-properties | 57.0.13 | 57.0.17      |
| expo-constants        | 57.0.13 | 57.0.17      |
| expo-file-system      | 57.0.5  | 57.0.6       |
| expo-linking          | 57.0.7  | 57.0.9       |
| expo-router           | 57.0.15 | 57.0.19      |
| expo-secure-store     | 57.0.1  | 57.0.3       |
| expo-splash-screen    | 57.0.7  | 57.0.8       |
| expo-system-ui        | 57.0.2  | 57.0.3       |
| react-native          | 0.86.2  | **0.86.3**   |
| eslint-config-expo    | 57.0.1  | 57.0.2 (dev) |
| jest-expo             | 57.0.4  | 57.0.5 (dev) |

react, react-dom, reanimated, worklets, svg, gesture-handler,
safe-area-context, screens, and react-native-web already sat at their
newest allowed versions and keep their pins. `expo-crypto` and
`expo-status-bar` were already current.

An incremental `npm install` ERESOLVEd (jest-expo 57.0.5 peer-wants
`@react-native/jest-preset@^0.86.3` while the lock held 0.86.2's), so the
lockfile was **regenerated from the new exact pins** and then proven with
a clean `npm ci` (1204 packages). One lockfile, exact direct pins, as the
brief requires.

### The imageless-splash plugin against 57.0.8 — checked two ways

The plugin's throw-guard existed for exactly this moment. First by
inspection: expo-splash-screen 57.0.8's config plugin build is
**byte-identical** to 57.0.7's (`diff -r` across the extracted tarballs:
zero differences), so the contract could not have moved. Then live: a
real `npx expo prebuild --platform android` on the refreshed tree
completed, the guard did not throw, and the generated
`values/styles.xml` carries **zero** `windowSplashScreenAnimatedIcon`
references — the dangling `@drawable/splashscreen_logo` item that broke
the first desktop build is stripped exactly as designed. The generated
`android/` directory was removed afterwards (CNG: never committed).

### The audit story: both HIGH advisories left the tree, and the gate ran clean for the first time

The regenerated lock **no longer contains `image-size` at all**
(`npm ls image-size`: empty) — the Metro/Expo chain dropped it in the
newer patches. Both high-severity waivers
(GHSA-w3rx-r6r6-pgpr, GHSA-5p2g-fcmc-qvqq, proposed 2026-08-21, never
ratified) therefore hit their own recorded retest instruction — "remove
this waiver as soon as a fixed image-size release ships" — and were
removed from `security/waivers.json`, with the removal reason recorded in
that file's `$history` and their full text preserved in git history.
Nothing was ratified; the waiver list is now empty, which also removes
both audit-waiver decisions from Kody's pending list. The evidence pair
(`security/evidence/npm-audit-current.json` + `.meta.json`) was
regenerated together per its own binding rule. The fresh audit shows two
distinct **moderate** advisories (decode-uri-component
GHSA-vcc3-ghjq-m6fr, uuid GHSA-w5hq-g745-h8pq), both in the Expo build
chain, both below the gate's high threshold: **audit:gate exit 0** — its
first clean pass in this project (it has been HOLD exit 3 on the
proposed waivers since 2026-08-21).

One test moved with the truth it pins:
`tests/scripts/audit-gate.test.mjs`'s flip-to-ratified negative read the
LIVE waiver file and went vacuous once that list emptied. It now accepts
the empty list as a valid state (asserting it validates clean) and runs
the flip-without-provenance rejection against a representative proposed
fixture as well as the live entries whenever any exist, so the negative
can never again silently pass on an empty file.

### Gates fresh on the refreshed tree (build container)

| gate                                                  | result                                                                                                                                                                                                                            |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| npm ci (dependency integrity)                         | clean, 1204 packages                                                                                                                                                                                                              |
| verify:toolchain                                      | exit 0 on the new pins (it reads package.json, nothing hardcoded)                                                                                                                                                                 |
| typecheck                                             | 0 errors                                                                                                                                                                                                                          |
| jest (jest-expo 57.0.5)                               | **403 passed / 30 suites**                                                                                                                                                                                                        |
| node:test                                             | **328 passed, 0 failed**                                                                                                                                                                                                          |
| eslint `--max-warnings 0` (eslint-config-expo 57.0.2) | clean                                                                                                                                                                                                                             |
| prettier                                              | clean                                                                                                                                                                                                                             |
| maestro:validate                                      | OK, 18 flows                                                                                                                                                                                                                      |
| config:check                                          | OK (development profile)                                                                                                                                                                                                          |
| expo prebuild (android)                               | completed; imageless-splash guard quiet; 0 icon refs                                                                                                                                                                              |
| export:candidate + bundle:inspect                     | OK — bundles under expo 57.0.20 / RN 0.86.3, zero QA-hook markers                                                                                                                                                                 |
| audit:gate                                            | **exit 0** (see above)                                                                                                                                                                                                            |
| secrets:scan                                          | ran on FULL history for the first time in-container (`git fetch --unshallow`); designed HOLD exit 3 — the two history exceptions on c666a92 stay PROPOSED awaiting Kody's written ratification, and the scan surfaced nothing new |
| expo-doctor                                           | 19/21 — the same two egress-blocked checks as every in-container run (config schema fetch, RN Directory); the dependency-version check that failed 20/21 on the desktop now passes. The definitive 21/21 is desktop evidence      |

### What this means on the desktops

react-native moved 0.86.2 -> 0.86.3, so the next `git pull` needs
`npm ci` and a **native rebuild** (`npx expo run:android`, ~7 min) before
any Maestro work — the installed dev build no longer matches the JS tree.
The find-36 verification sequence is unchanged, just preceded by that
rebuild. Remaining Kody-owned decisions after this cycle: the history
exceptions (ratify or decline; the audit waivers are gone), the Maestro
pin attestation, Expo account/terms for the iOS compile lane, and
Stacie's client wording swap.

## 2026-09-06, later still — find 20 fixed: a QA hook that EXPIRES the stored session

Autonomous forward motion (Kody away). Find 20 recorded that
`expired-session.yaml` could not be produced by its documented pre-step: a
server-side session revoke cannot make the app show the expired notice,
because the app reads its session locally with `autoRefreshToken: false`
(confirmed at `src/data/supabase/client.ts:225`), so `getSession()`
returns the stored session verbatim and the boot check keys off its
`expires_at` (`src/auth/controller.ts:224` -> `BOOTED_EXPIRED` ->
signed_out, reason `expired`), never off server session rows. A revoked
session keeps reading until the stored JWT's own `exp`, an hour out.

The fix is the executable counterpart to the corruption hook, and the
distinction between the two is the whole point:

| QA deep link                          | writes                                                         | next boot                      |
| ------------------------------------- | -------------------------------------------------------------- | ------------------------------ |
| `hivedev:///?qa=corrupt-storage`      | a non-JSON manifest marker                                     | `storage_quarantined`          |
| `hivedev:///?qa=expire-session` (new) | the session with `expires_at` in the past, THROUGH the adapter | `signed_out`, reason `expired` |

`src/dev/qa-expire-session.ts` reads the persisted session via the same
`SessionStorageAdapter` the app uses, rewrites `expires_at`/`expires_in`
into the past preserving every other field, and writes it back — so the
manifest digest is RECOMPUTED and the session still verifies. It is
expired, not corrupt. It refuses to fabricate a session over
missing/corrupt storage (returns false, so the flow's ack never renders
and the assertion fails loudly rather than passing against a state the
pre-step never produced).

Ship-safety is the corruption hook's proven scaffold, reused wholesale:
`__DEV__ && EXPO_PUBLIC_QA_HOOKS === '1'` gate in `app/_layout.tsx`; a
marker-free `.stub.ts` that `metro.config.js` swaps in unless QA hooks are
enabled at build time (the resolver now carries a two-hook list);
`config:check` rejects the env flag outside development; and the
`qa-hook-marker` bundle-inspect pattern now covers BOTH markers
(`HIVE_QA_CORRUPT_HOOK`, `HIVE_QA_EXPIRE_HOOK`).

The absence proof was made non-vacuous, on real exports rather than by
inspection:

- `EXPO_PUBLIC_QA_HOOKS=1 expo export` — both markers PRESENT (the real
  modules bundle).
- `export:candidate` (QA off) — `bundle:inspect` passes with ZERO QA-hook
  markers (stubs resolved).

`expired-session.yaml` is rewritten self-contained on the corruption
flow's model: launch (signed in) -> select workspace -> fire the expire
deep link -> wait for the `qa-expired-ack` -> stopApp -> relaunch ->
assert no `dashboard-workspace`, the `signed-out-reason`, and the exact
"Note: Your session ended. Sign in again to continue." notice.

### Gates fresh (build container)

typecheck 0; jest **410 passed / 31 suites** (7 new expire-hook tests);
node:test **328 passed, 0 failed** (bundle-inspect marker test now pins
both markers); eslint `--max-warnings 0` clean; prettier clean;
maestro:validate OK 18; config:check OK; audit:gate OK; verify:toolchain
OK; export:candidate + bundle:inspect OK; QA-on export carries both
markers.

### State

Execution stays HOLD on the device lane (no device/simulator in the build
container), so the flow is authored, unit-proven, and export-proven here,
and RUNS on the desktop QA build — the same posture as every other device
flow. When the desktop runs it (QA build, `EXPO_PUBLIC_QA_HOOKS=1`),
`expired-session` should move from HOLD to PASS. That would leave, of the
18 flows, only `read-surfaces-denied` (find 21, the mid-flow revoke
helper) still HOLD once find 36's four flows are verified — i.e. a path to
**17 of 18**. Find 21 remains the last cloud-authorable harness piece; its
design (a loopback membership-revoke helper holding the service bearer in
memory, like `totp-helper`, hit by a mid-flow `runScript` at the sync
point between the requests list and the refresh tap, with the membership
restored on cleanup) is traced and ready to build.

## 2026-09-06, evening — find 21 built: the last flow is executable

Kody delegated the twelve open decisions; find 21 was "build". This is
the final cloud-authorable piece of the Maestro set: with it, all 18
flows are executable, and what remains is desktop evidence.

### Why the design looks the way it does

`read-surfaces-denied.yaml` needs a membership revoked MID-FLOW, between
"the requests list is on screen" and the refresh tap. Driven from outside
(find 21, 2026-09-03), the delete landed after the refresh request went
out and the stale state never appeared. Maestro's only mid-flow hook is a
GraalJS `runScript` with `http`, so something must serve HTTP, and the
privileged credential must never reach the flow. Four decisions follow:

1. **The endpoint lives IN the runner process.** The TOTP secret needed
   its own process so its death was the secret's erasure; a membership row
   is not a secret. One process means the credential never crosses a
   process boundary, and there is no helper-death fail-open — exactly the
   class of failure find 36 had just closed.
2. **The target comes from the canonical identity matrix, never from an
   argument.** `resolveRevokeTarget` derives the seeded rows for
   `client.owner@example.invalid` on `entityA1` from
   `scripts/lib/synthetic-identities.mjs`, so restore knows what to put
   back whether or not the revoke response was ever seen, and the endpoint
   refuses any request naming anything else (loopback callers only,
   single-use, exact-target).
3. **Restore runs on every exit path and is idempotent.** Cleanup inside
   `process.on('exit')` must be synchronous, so the restore is a harness
   (`scripts/membership-restore.mjs`, the `reset-totp` shape) invoked with
   `spawnSync` and bounded. It goes through the seed's own
   `on_conflict … resolution=ignore-duplicates` upsert — never an UPDATE,
   so the scope-immutability trigger is never in play — and readback must
   match the seed definition exactly. The `revoked` flag is set BEFORE the
   delete goes out, so a run that dies mid-request still restores. The
   same harness is the manual recovery:
   `node scripts/local-supabase.mjs restore-membership <email> <entityKey>`.
4. **The flow learns the endpoint through Maestro `-e`.** The runner passes
   `REVOKE_HELPER_URL` before the flow file; `revoke-membership.js` POSTs
   the account label and entity key (no secret, no credential) and THROWS
   when the revoke did not happen, so the flow fails at that step with the
   reason instead of asserting a state the pre-step never produced.

Two supporting changes: `scripts/lib/bounded-spawn.mjs` extracts find 36's
bounded-spawn shape (exit+drain, never `close` alone; tree kill) for reuse
— the enrollment runner keeps its inline copy UNTOUCHED until its desktop
verification lands, then consolidates — and `local-supabase.mjs` now
exports `resolveServiceCredentials()` (the status→bearer→PostgREST-probe
resolution `runHarness` always did) and gains the `restore-membership`
subcommand.

One assumption is recorded rather than hidden: the helper script uses
Maestro's documented GraalJS `http.post(url, { headers, body })` returning
`{ ok, status, body }`. `maestro:validate` proves the YAML and the script
file exist and carry no banned pattern; the desktop run is the proof of
that call shape.

### Evidence

Fourteen tests added: `tests/scripts/membership-revoke.test.mjs` (the
canonical target and its five-column restore shape, refusal of every
non-seeded pairing, the exact-target request law, port parsing, loopback
law, restore pinned to the seed's own upsert path by reading the seed
source) and `tests/scripts/bounded-spawn.test.mjs`, whose two proofs run
on real processes: a child that exits 7 leaving a grandchild on its pipe
settles on exit+drain with its output intact in under a second, and a
stuck tree under the watchdog is left with nothing running (zombies
only). The runner's module loads in the container and smoke-holds at exit
3 with its imports from the enrollment runner and local-supabase proven
inert.

Gates fresh (build container): node:test **342 passed, 0 failed**; eslint
`--max-warnings 0` clean; prettier and format:check clean;
maestro:validate OK (18 flows, 5 helper scripts); typecheck 0; jest
410/31 suites.

### State

All 18 flows are now executable. Desktop evidence still owed, in order:
the find-36 rerun (`maestro:enroll`, `maestro:confinement`; 4 flows), a QA
build for `expired-session` (find 20; 1 flow), and `npm run
maestro:denied` (this entry; 1 flow). Success on all three is **18 of
18**. Nothing cloud-authorable remains in the Maestro set. Kody-owned
items unchanged: the four history exceptions (ratify by written
statement), the iOS lane (Expo account/terms, hardware; deferred), and
Stacie's client wording (current text kept).

## 2026-09-06, night — ratification tooling, dry-run proven against the real gate

Kody delegated the open decisions and asked for everything that needs no
intervention. The last red gate, `secrets:scan`, is HOLD on four proposed
history exceptions that only his written word can ratify — but the
mechanics around that word were a multi-step, error-prone procedure with
no tooling. Now there is tooling, and it is proven.

`scripts/ratification-record.mjs` has two subcommands. `draft --out
<file>` writes the approver's decision record — approver, role, action
`history-exception-ratification`, the manifest digest over the whole
effective allowlist exactly as the gate computes it, the candidate commit,
destination, approval time, the shared expiry, and the four bound entries
— and REFUSES an output path inside the repository, mirroring the loader's
rule. `apply --digest --ratified-on` flips every proposed entry to
ratified with the provenance the verifier demands, touching no substantive
field, so the bound manifest digest is unchanged by it. Both are pure
decisions with an `isMain` guard; seven tests verify a drafted record
against the real `verifyRatification` for every live entry, pin the
digest's determinism, and cover the refusals.

Nothing about the approval model moved. The record still lives outside
the repo, is still supplied through `HIVE_APPROVAL_RECORDS` with its
digest stated independently through `HIVE_APPROVAL_DIGESTS`, and names
the candidate commit whose substance it approves, so verification runs
with `HIVE_CANDIDATE_SHA` set to that commit — the entry flip is itself a
later commit, and a record cannot name the commit that carries its own
digest. The tooling drafts; only the approver's written ratification and
their out-of-band custody of the file make it authority.

### The proof

The whole procedure was dry-run in the build container against the real
gate, with a throwaway record: `draft` to `/tmp` (outside the repo),
`apply` on the working tree, then

    HIVE_CANDIDATE_SHA=825cd11… HIVE_APPROVAL_RECORDS=/tmp/… HIVE_APPROVAL_DIGESTS=a6a08dc0… npm run secrets:scan

answered **`secrets:scan OK`, exit 0** — self-test ok, 264 tracked files,
703 history blobs with completeness verified, 4 history-exception entries
reconciled covering 5 historical matches, secretlint clean. The first
clean pass of that gate in the project. The allowlist was then reverted
with `git checkout` and the record deleted: nothing is ratified, nothing
was committed by the proof, and the tree carried only the two new tooling
files afterwards.

What ratification now costs Kody: one written sentence, then the two
printed commands. On his word the implementer runs `draft` and `apply`,
commits the flip, and he keeps the record file and runs the verification
line on his machine.

## 2026-09-06, late night — independent review of the day's four commits: seven findings, all fixed

Before the desktop reran anything, a separate reviewer read the day's
range (`45999cc..1295070`: the find-36 fix, the pin refresh, find 20,
find 21, the ratification tooling) against the installed library sources
and the runners' process model. Three P1 findings and four P2 findings,
every one reproduced from the code rather than argued, all fixed here.

### P1-B — the find-36 fix hardened the wrong thing; the root cause was the exit

The morning's watchdog and tree-kill are real hardening, but they were not
why `maestro:enroll` sat "alive, no Maestro child, no further output"
after its OK line. The totp-helper is a live ChildProcess with a listening
socket; it keeps Node's event loop alive, so after the final
`console.log` the runner simply never reached exit, the `process.on('exit')`
cleanup never fired, and the helper stayed up with the setup secret in
memory. That is the hang Kody saw, and it fails OPEN. The runner now calls
`cleanup('success')` explicitly, checks its outcome, prints OK only over a
verified cleanup, and calls `process.exit(0)`; the confinement probe does
the same. `revokeFactor` and `scrubClipboard` return booleans and set
`process.exitCode = 1` on failure (P2-E), so a failed cleanup step can no
longer hide behind a successful run's exit code.

### P1-A — the denied runner had the identical defect, worse

Its in-process revoke endpoint is a listening server: after the OK line
the process stayed alive, exit-time cleanup never ran, and the seeded
membership stayed REVOKED while the OK text claimed it restored. Same
fix: explicit cleanup returning `{ restored }`, OK only when restored,
explicit exit; `restoreMembership` sets `exitCode = 1` on failure.

### P1-C — find 20's premise was wrong, and it hid a product defect

Find 20 said the app reads its session locally with `autoRefreshToken`
off, so a server-side revoke changes nothing until the token's own `exp`.
The second half is true; the first half is not. Read from the installed
auth-js 2.112.3 (`__loadSession` → `_callRefreshToken`): `getSession()`
refreshes a lapsed stored session at boot regardless of
`autoRefreshToken`, which only governs the background timer. So the QA
hook's expired `expires_at` alone would have been silently undone by the
still-valid refresh token, and `expired-session.yaml` would never have
seen the notice.

The defect underneath is independent of the hook: a stored session whose
refresh the auth server REJECTS at boot (revoked, rotated, expired refresh
token — the real "session ended" case) surfaced as an error from
`getSession()`, which the controller routed through `handleStorageOrFatal`
to the FATAL screen, never the expiry branch. Fixed at the port: the
gateway classifies a failed `getSession()` (`classifyGetSessionError`: a
retryable fetch error is an unreachable server → `SessionOfflineError`; an
auth API 4xx is the server rejecting the refresh → `SessionExpiredError`;
anything else stays fatal), and boot maps the two to
`cleanupLocalSession('expiry')` + `BOOTED_EXPIRED` and to
`BOOTED_OFFLINE`. The hook now also replaces the stored refresh token with
the inert `HIVE_QA_EXPIRED_REFRESH_TOKEN`, so the boot refresh is
definitively rejected: the flow exercises exactly the real revoked-session
path. One more thing the library does, pinned by a test: on that rejection
it removes the stored session and notifies `SIGNED_OUT` before returning;
the controller's listener enqueues a sign-out sequence that finds
`signed_out` and returns, so there is exactly one deletion and one remote
revocation, never two.

### P2 — four smaller fail-open edges

- **P2-D** One shared run-root prefix let either runner sweep a concurrent
  peer's confined artifact directories mid-flow. Each runner now owns its
  prefix (`hive-maestro-enroll-`, `hive-maestro-denied-`) and sweeps only
  that.
- **P2-F** A zero-row DELETE proved nothing: had a prior restore failed,
  the flow would have proceeded having revoked nothing. `verifyDeletedCount`
  demands exactly the seeded rows gone, alongside the empty readback.
- **P2-G** A signal during an in-flight revoke could let the restore run
  first and the queued delete undo it. Signal handlers now await the
  in-flight revoke (bounded, 5 s) before cleanup.
- **Nits** `killTree` also skips a signal-killed, reaped child (never
  signal a pgid that may have been reused); `readbackPath` is
  `revokePath` by construction so the two filters cannot drift; the hook
  and flow headers state the corrected premise.

### Gates fresh (build container)

typecheck 0; jest **416 passed, 32 suites** (session-error classification
3, controller boot 3 new); node:test **350 passed, 0 failed**; eslint
`--max-warnings 0` clean; prettier and format:check clean;
maestro:validate OK (18 flows, 5 helper scripts); both runners smoke-HOLD
at exit 3 here (no Maestro binary).

### State

Desktop evidence owed is unchanged in kind but the code under it changed:
the find-36 rerun (`maestro:enroll`, `maestro:confinement`; 4 flows), the
QA build for `expired-session` (1 flow), and `maestro:denied` (1 flow)
must all run on this head. A `maestro:enroll` started on the pre-fix code
will still hang after its OK line — Ctrl+C once, then `git pull`. Nothing
is claimed verified on a device until it is.

## 2026-09-06, late night — Find 37: `hideKeyboard` is a BACK press, and it was leaving the app

Kody's first `maestro:enroll` on the reworked runner (desktop 2, API 35
lane) got through sign-in, the email code, enrollment, the secret capture,
the wrong-code entry and `hideKeyboard`, then failed at `tapOn mfa-submit`
with "Element not found". The runner's failure path then did everything
it promises — helper terminated, clipboard overwritten, the leftover
factor revoked (1 deleted, readback zero), run root removed and verified
gone — and exited on its own. That is the fail-closed path, seen on
Windows; the success path (explicit cleanup, then exit) is still owed.

### The diagnosis, from source

- Maestro's Android driver implements `hideKeyboard` as `input keyevent 4`
  — the BACK key — unconditionally, then sleeps 300 ms
  (`AndroidDriver.kt`, identical at v1.40.0, v2.0.0 and main; the pinned
  CLI is 2.10.0).
- This app's auth screens REPLACE one another (expo-router `Redirect` is
  `router.replace`), so the stack holds one entry. A BACK that reaches
  the app there finishes the activity.
- With a soft keyboard up, BACK only dismisses the keyboard — which is why
  the 2026-09-05 probe, keyboard up on that emulator, saw `mfa-submit`
  intact after `hideKeyboard`. With no soft keyboard showing (an AVD with
  its hardware keyboard enabled behaves this way), the same BACK reaches
  the app, the app leaves the screen, and every later step fails "not
  found" — exactly today's log.
- Established from source: the BACK press and the single-entry stack.
  Confirmed only by the rerun: that no soft keyboard was showing on this
  emulator. Recorded as the diagnosis, not as device evidence.

### The fix

- `TextField` gains `labelTestID`; the MFA code field's label is
  `mfa-code-label`. The label is plain text, never a control, and sits
  directly above the input, so it is on screen whenever the input is. A
  tap on it is unhandled, the ScrollView blurs the input, and the soft
  keyboard, if any, goes with the focus. Nothing else happens if none is
  up.
- `mfa-enroll.yaml` (both verify rounds) and `mfa-login.yaml` tap
  `mfa-code-label` where they used `hideKeyboard`.
- `maestro:validate` now REFUSES `hideKeyboard` with the reason (a
  `FORBIDDEN_COMMANDS` map, checked before the vocabulary), so it cannot
  return as "known"; its testID harvest recognizes props ending in
  `TestID`, since it would otherwise refuse the very target that replaces
  the command. Tests: the refusal carries the reason and is not merely
  "unknown"; both MFA flows blur by label immediately before every
  `mfa-submit` tap and contain no `hideKeyboard`; the harvest form is
  proven on ids no screen renders.
- Find 30 stands corrected in one respect: dismissing the keyboard before
  the tap was right; the command chosen to do it was a BACK press in
  disguise.

### Gates fresh (build container)

maestro:validate OK (18 flows, 5 helper scripts); node:test **352 passed,
0 failed**; jest 417 across 32 suites; typecheck 0; eslint
`--max-warnings 0`, prettier and format:check clean.

### State

Desktop evidence owed is unchanged in kind: the enrollment sequence on
this head (`maestro:enroll`, then `maestro:confinement`), the QA build for
`expired-session`, and `maestro:denied`. The next `maestro:enroll` run is
the proof of both this finding and the runner's success-path exit.

## 2026-09-06, late night — desktop 2: the enrollment sequence passes end to end; finds 36 and 37 confirmed on the device

Kody reran `npm run maestro:enroll` on desktop 2 (the Pixel_8 API 35
lane, Maestro 2.10.0) at head eaa31f1, output captured to a log file.
Every step of every flow completed:

- `mfa-enroll.yaml`, 30 steps: sign-in, OTP read mid-flow from Mailpit,
  the enrollment screen, the setup key captured into the loopback
  helper's memory and the clipboard overwritten, the guaranteed-wrong
  code, a tap on `mfa-code-label`, then `mfa-submit` on the first try,
  `mfa-notice` with the QR still on screen, a fresh code, the label tap
  again, submit, `dashboard-workspace`.
- `staff-sign-out.yaml`, 10 steps.
- `mfa-login.yaml`, 18 steps: no second QR, verify against the existing
  factor through the same label tap, dashboard.
- Then the post-run revocation (`1 deleted, readback verified zero`), the
  helper terminated, the clipboard overwritten with reason `success`, the
  run root removed and verified gone, `maestro:enroll OK`, and **the
  prompt returned on its own**.

### What that proves

- **Find 37, confirmed on the device.** Earlier the same evening, the
  same flow on the same emulator died right after `hideKeyboard`; with
  the label tap in its place the verify control was found and tapped on
  the first attempt in both enrollment rounds and in verify mode. The
  BACK-press diagnosis was made from Maestro's source; this run is the
  device evidence the find 37 record said was still owed.
- **Find 36's true fix, confirmed on Windows.** After the OK line the
  process exited by itself: explicit, verified cleanup, then exit. The
  runner's failure path had already been seen on this desktop earlier in
  the evening (fail, exit-time cleanup, prompt back); now the success path
  is seen too. The hang is gone.
- The factor-reset, loopback-helper, and clipboard-scrub controls ran as
  designed on the success path, each printing its reason.

### The tally: 15 of 18

The 12 flows recorded green on 2026-09-03 plus `mfa-enroll`,
`staff-sign-out`, and `mfa-login`. Remaining, in the order to run them:
the confinement probe (`npm run maestro:confinement`, the fourth flow
find 36 blocked), `read-surfaces-denied` (`npm run maestro:denied`), and
`expired-session` on the QA build (find 20). Success on all three is 18
of 18.

## 2026-09-06, late night — desktop 2, second run: the confinement probe passes; two product findings from the last two lanes

A session on Kody's desktop (started through the remote-control bridge
he set up tonight) ran the remaining lanes at head bb33ccb and wrote a
report; the emulator was healthy on every check, so the earlier
`Can't find service: package` condition was not reproduced and no cold
boot was needed.

- `npm run maestro:confinement`: **PASS**, exit 0. The forced failure on
  the enrollment screen captured 7 artifacts and 1 screenshot, ALL inside
  the private run root, none in `~/.maestro/tests`; the factor was
  revoked, the clipboard overwritten, the run root removed and verified
  gone; `maestro:enroll CONFINEMENT PROOF OK`. That is the fourth flow
  find 36 blocked: **16 of 18**.
- `npm run maestro:denied`: FAIL, exit 1. Everything up to and including
  the mid-flow revoke worked (`membership revoked mid-flow (1 row(s)
deleted); readback verified zero`), the refresh tap landed, and then
  `requests-stale` never appeared within 20 s. Cleanup restored the
  membership and verified it. Find 38 below.
- `sign-in.yaml` failed on its first attempt because the app was still
  signed in from the denied lane (it launched with `clearState: false` and
  met the workspace chooser); after `pm clear` it passed every step.
- `expired-session.yaml`: FAIL at `signed-out-reason`. The hook fired
  (`qa-expired-ack` visible), the relaunch showed no protected content
  (`dashboard-workspace` not visible), and the sign-in screen came up
  WITHOUT the "session ended" notice. Find 39 below.

### Find 38 — a revoked membership is invisible to a running session

Membership is server-controlled, but the app only read the actor's
memberships at sign-in (`loadAndRoute`). `useScopedLoad` already had the
right rule — a bound scope whose membership is missing from the list
renders `stale_scope`, never old rows — and nothing ever changed the
list. After the revoke, the refresh re-ran the requests query; RLS
quietly filtered the revoked workspace's rows; the screen showed
"nothing here". Truthful about the rows, false about the reason, and the
chooser would have offered the revoked workspace again.

Fixed at the controller: `refreshMemberships()` re-reads the actor's
memberships from the server, and the reducer takes a new
`MEMBERSHIPS_REFRESHED` event in `authorized` and `select_scope` that
replaces the list while KEEPING the bound scope (so the screens render
stale scope with the chooser action). An actor left with no membership at
all runs the full sign-out sequence with the new `no_access` reason —
never left authorized. A read that fails keeps the current list: a failed
re-read grants nothing, and the data surfaces show their own offline or
error state. Every screen's refresh (`useScopedLoad.retry`) now
re-validates as well as re-reads, and `switchScope()` re-reads before the
chooser renders so a revoked workspace is never offered again. Red-green:
four reducer cases, seven controller cases (revoke one → scope kept and
list shrunk; revoke all → `signed_out(no_access)` with storage deleted
and remote sign-out; server unreachable → state object unchanged;
unchanged list → no transition; chooser re-reads first; chooser with
nothing left signs out; no-op outside a scope state), and a hook-level
test that a retry calls the re-validation and that a bound membership
missing from the refreshed list renders `stale_scope`. Not handled, and
noted: a refreshed set that newly requires AAL2 for an aal1 actor is left
to the server's restrictive staff policies, which deny those reads
regardless.

### Find 39 — the expiry hook raced the running app's own refresh

The relaunch showed the plain sign-in screen because, by the time the
flow force-stopped the app, the stored session was already GONE: opening
the QA link resumes the activity, the controller restarts the auth
library's foreground refresh on every resume, and that restart runs a
tick at once. The tick reads the stored session; with the expired
envelope already written it refreshed, was rejected, removed the session
and signed the running app out with the reason — which the flow never
looked at — and the relaunch under test then found no session at all and
took the `initial` branch. (The periodic 30 s tick could do the same in
the seconds before the force-stop.) The product behaviour is right in
both branches; the hook broke the flow's premise that the session dies
while the app is away.

Fixed in the hook, not the product: `expireStoredSessionForQa` takes a
`quiesce` callback the layout wires to "wait 750 ms for the resume cycle
to finish on the still-valid session, then tell the controller the app is
not in the foreground (which stops the foreground refresh exactly as a
backgrounded app does), then settle" — and only then writes. The flow
force-stops the app right after the acknowledgment, so nothing else
observes the expired envelope before the relaunch. Test: the quiesce
runs once, before the first storage read.

### Hygiene from the same report

`sign-in.yaml` now launches from a CLEARED app state with the bounded
wait a cleared install needs (find 31), so the lanes run in any order.

Gates fresh (build container): typecheck 0; jest **431 across 33
suites**; node:test 352 passed, 0 failed; eslint `--max-warnings 0`,
prettier, format:check clean; maestro:validate OK (18 flows, 5 helper
scripts).

### State

**16 of 18.** Owed on this head: `maestro:denied` and `expired-session`
(on the QA build), both reworked above; a desktop rerun of exactly those
two is the next step.

## 2026-09-07 — desktop 2, third run: 18 of 18 on the device lane

The same desktop session mechanism, at head 09ca083 (pulled
`--ff-only` from bb33ccb during its state check; emulator healthy, Metro
untouched), ran the two reworked lanes and wrote its report:

- `npm run maestro:denied`: **PASS**, exit 0. After
  `membership revoked mid-flow (1 row(s) deleted); readback verified
zero` and the refresh tap: `requests-stale` visible, `requests-list`
  not visible, the row text not visible, the "Choose a workspace" action
  visible; then `membership-restore: client.owner@example.invalid on
entityA1 restored (1 seeded row(s) present, readback verified)`, run
  root removed and verified gone, `maestro:denied OK`, prompt returned.
  Find 38 confirmed on the device: the refresh re-read memberships from
  the server and the screen told the truth.
- `sign-in.yaml`: **PASS**, exit 0, 15 of 15 steps COMPLETED — now from
  a cleared app state with the bounded wait, so it no longer depends on
  what the previous lane left behind.
- `expired-session.yaml`: **PASS**, exit 0, 12 of 12 steps COMPLETED:
  `qa-expired-ack` (hook fired), stop, relaunch, `dashboard-workspace`
  not visible, `signed-out-reason` visible, and the text "Note: Your
  session ended. Sign in again to continue." visible. Find 39 confirmed
  on the device: with the running app's refresh quiesced before the
  write, the relaunch took the expiry branch — which is also the device
  proof of the 2026-09-06 review's boot-time dead-session fix.
- Tidiness: no `hive-maestro-*` run roots left in TEMP; nothing
  listening on 8477 or 8478; Metro and the emulator left running.

### The tally: 18 of 18

Every Maestro flow in `.maestro/` has now passed on the API 35 emulator
lane, all of them at heads on or after eaa31f1, the last six on
09ca083. Nothing in the Maestro set is HOLD.

### State

Cloud-side next: the clean-checkout drill at this head. Kody-owned, in
his own words: the ratification of the four proposed history exceptions
(`secrets:scan` is the one remaining HOLD gate, by design), Stacie's
client-facing wording, and the iOS lane when the Expo account and
hardware exist. The `main` branch question stands: this branch's pull
request still targets another session's branch, and a release-candidate
conversation needs a real integration branch first.

## 2026-09-07 — clean-checkout drill at `7bd7808`: the whole system from git alone, plus two public values

Fresh clone of the pushed branch into an empty directory (`/tmp`, so the
`hivepg` traversal rule from the earlier drill holds), `npm ci` from the
lockfile, every static gate, the stack binaries from nothing, both live
lanes, then the candidate export lane. Per-step exit codes were captured
by the drill script itself:

| Drill step                                 | Result                                                                                               |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| clone → HEAD                               | `7bd7808`                                                                                            |
| npm ci                                     | exit 0                                                                                               |
| typecheck                                  | exit 0                                                                                               |
| jest                                       | **431 passed across 33 suites**                                                                      |
| test:scripts (node:test)                   | **352 passed, 0 failed**                                                                             |
| eslint `--max-warnings 0`                  | exit 0                                                                                               |
| format:check                               | exit 0                                                                                               |
| maestro:validate                           | OK — 18 flows, 5 helper scripts                                                                      |
| audit:gate                                 | OK — 2 advisory sources across 14 package nodes, none high/critical uncovered                        |
| secrets:scan                               | **HOLD, exit 3, by design** — 4 history exceptions PROPOSED, not ratified; 268 files, 763 blobs      |
| fetch:e2e-binaries (cold)                  | exit 0 — postgrest and mailpit from the pinned, digest-verified releases; gotrue REBUILT at v2.196.0 |
| binary stack: black-box harness (`run`)    | exit 0 — **157 passed, 0 failed**                                                                    |
| binary stack: app composition (`bridge`)   | exit 0 — **7 passed, 0 failed**                                                                      |
| config:check                               | FAILED in the bare clone; exit 0 once `.env.local` was supplied (see below)                          |
| export:candidate (inspects its own output) | exit 0 once `.env.local` was supplied — bundle:inspect OK, zero QA-hook markers across 73 files      |

**The one input git does not carry.** `config:check` and the export lane
read `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_CLIENT_KEY` from
the environment or from the untracked `.env.local`. In the bare clone
both failed with exactly "configuration is missing …" — the fail-closed
answer, since an export with no configuration must not be produced. The
file holds those two public values and nothing else (the local loopback
URL and the approved public client key; never a secret), so it is the
same two values any machine needs, and this is recorded as the drill's
single non-git input rather than hidden by pre-seeding it. The drill
script's separate `bundle:inspect:candidate` call afterwards reported "no
export found at ./dist" — that invocation expects a bare `expo export`
into `dist/`, which the candidate lane does not produce because it
inspects and then removes its own temporary export; a drill-script
misstep, not a lane result, and the lane's own inspection is the one that
counts.

### State

Everything runnable runs green from a clean clone at this head, with the
two public configuration values as the only inputs and `secrets:scan` the
only HOLD, awaiting Kody's written ratification. Device lane: 18 of 18.
Kody-owned: the ratification sentence, Stacie's client-facing wording,
the iOS lane, and where `main` lives.

## 2026-09-07 — ratification: the four history exceptions, in Kody's words

Kody wrote, in this session: "I ratify the four proposed history exceptions
in security/secret-scan-allowlist.json." That sentence is the authority the
approval model has waited on since 2026-08-21; everything below is
mechanics, executed exactly as `security/APPROVALS.md` and the ratification
tooling prescribe.

- `draft`: the decision record was written OUTSIDE the repository at
  candidate `986d5a35c2190fc580b9b92d0e77a9d5055f9c02` (the head at the
  moment of ratification; the flip is the commit after it), binding the
  four entries, the manifest digest
  `2f5a5a30…aaae4b` over the whole effective allowlist, the shared expiry
  2026-11-21, approver Kody, and approvedAt `2026-09-07T00:20:48Z`. Its
  sha256 — `b374a222…7f66f9` — was recomputed independently with
  `sha256sum` and matched.
- `apply`: all four entries flipped from `proposed` to `ratified` with
  `ratifiedOn 2026-09-07`, `ratifiedBy Kody`, the reference, and the
  record digest; no substantive field changed, so the manifest digest the
  record binds is unchanged by the flip.
- Verification, record supplied out-of-band through
  `HIVE_APPROVAL_RECORDS` with the digest stated independently through
  `HIVE_APPROVAL_DIGESTS`, at `HIVE_CANDIDATE_SHA` = the candidate:
  **`secrets:scan OK`, exit 0** — self-test ok, 268 tracked files, 750
  history blobs with completeness verified, 4 history-exception entries
  reconciled covering 5 historical matches, secretlint clean. Without the
  record the gate FAILS with exit 1 ("an entry claiming ratification
  proves nothing on its own"), which is the point.

Custody: the build container is ephemeral, so the record is handed to
Kody's own machine byte-exactly (base64 through the desktop session,
digest re-checked there), into a directory outside any checkout. He keeps
it; the repository carries only the digest and the reference.

### State

No gate is HOLD at this head. Every runnable gate is green from a clean
clone, the device lane is 18 of 18, and `secrets:scan` exits 0 with the
approver's record supplied out-of-band. Kody-owned next: Stacie's
client-facing wording, the iOS lane, and where `main` lives.

### Custody confirmed on Kody's machine (2026-09-07)

The record was written byte-exactly on Kody's desktop (base64 to bytes, no
text encoding in the path) at
`C:\Users\kodyr\HIVE-approvals\history-exceptions-2026-09-07.json` —
outside any checkout — and he ran the verification line there at
`1371b66`: **`secrets:scan OK`** — self-test ok, 268 tracked files, 771
history blobs with completeness verified (his clone carries more history
than the build container's), 4 history-exception entries reconciled
covering 5 historical matches, secretlint clean. The approver holds the
only copy; the repository holds the digest.

## 2026-09-07 — client-facing wording: every string reviewed, the decisions taken

Kody asked for every client-facing string with analysis, then said "make
the recommended changes and fix the four concerns; make the best decision
for us". Relationship language is Stacie's (WO-002 D4), so every word
below is placed where she can change it without touching a screen, a
query, or a flow: statuses, roles, and activity words in one table
(`labels.ts`), the error lines in one table (`errors.ts`), and each
screen's own text in its view. The review itself is published as a page
for Kody and Stacie; this is the record of what changed and why.

### The four concerns

1. **"Contact Honeybee Accounting" had nowhere to go.** No address may be
   invented, so the channel is now a configured public value:
   `EXPO_PUBLIC_SUPPORT_EMAIL`, optional, validated as an address, and
   refused outside development when it uses a reserved or testing domain
   (`.invalid`, `.test`, `.example`, `example.com`). When set, Help and
   Account carry a tappable `Email <address>` line that opens the mail
   app; when unset, they say to reach the team the way clients do today.
   Every remaining mention reads "contact your Honeybee team". Tests cover
   accept, refuse, development allowance, and both screens with and
   without the value; the "invents no channel" test still holds.
2. **A wrong or lapsed email got the generic line.** The gateway now maps
   the invite-only refusal (422, `otp_disabled` / `signup_disabled`) to
   `not_authorized` — "We could not send a code to this email. If you
   expect access to HIVE, contact your Honeybee team." — and a rate limit
   (429 or an `over_*_rate_limit` code) to `rate_limited`. The line says
   what happened and what to do without stating whether the email is
   authorized; the server already answers unknown emails differently, so
   the app's wording is not what keeps that private. Kody may still
   choose the generic line back; it is one table entry.
3. **The real sign-in email does not exist yet.** The hosted project is
   HOLD, so only the local template could be aligned ("Enter this sign-in
   code in the HIVE app to continue"). Recorded as owed: subject, sender
   name, body, and the expiry claim, which must match the hosted setting.
4. **A build label on the client's Help screen.** The last line now reads
   "Help text updated September 7, 2026 (version 1.1.0)": a plain fact
   for the reader, the version kept for support.

### The wording changes

One name for the code (`sign-in code`; field label, lead line, hint, code
screen, email); the reset path speaks of "sign-in on this device" and
"Your records are safe with Honeybee"; one tense for "Your session ended";
the offline body says nothing unverified is shown; Home says "Anything
that needs you will show up here"; owners and actors are "Honeybee
team", "Your preparer", "Honeybee reviewer", "Honeybee approver", "You",
and "HIVE"; badge prefixes are "Status", "Done", "Needs attention",
"Paused"; a request's "Expired" keeps its familiar word but carries the
plain status prefix (what makes a request expire is the workflow's to
define); the chooser shows and reads a business name once when it is also
the entity name; the email placeholder is `you@yourbusiness.com`; the two
full-stop screens share one text; "Waiting on documents" and "Returned
for changes" replace "Waiting on records" and "Needs another pass"; the
authenticator screen tells staff who can reset a lost authenticator.
Decided and kept: no contractions anywhere (consistent and calm), and the
visible "Note/Problem" prefixes (what is shown is what is heard).

### Flows

The sign-in lead sentence was asserted in six flows as the signed-out
landmark; those assertions now use the field's testID, so wording is
Stacie's to change without breaking the device lane. The clipboard scrub
copies the title. The two quarantine flows assert the new words. Every
chooser tap uses the deduplicated row label. `maestro:validate` OK.

Gates fresh: typecheck 0; jest **445 across 35 suites** (new: support
address validation, sign-in answers, chooser rows, Settings, Help);
node:test 353; eslint, prettier, format:check clean. Device evidence for
the changed flows is owed and is the next run.

## 2026-09-07 — the HIVE 2026 design, implemented: Brand Kit v3.0, the approved mark, Manrope

Kody supplied the HIVE 2026 design package (direction PDF, Brand Kit v3.0,
the approved 2026-08-25 honeycomb product mark, five static Manrope faces,
a token reference and an implementation map) and instructed: implement it
in the native app, one reviewable slice first, then carry it through; the
package is a design draft for implementation and review, not approval to
publish. The reviewed source was `ca96181`, which was the head, so nothing
newer needed preserving. The package is kept byte for byte under
`docs/design/2026-09-07-hive-2026-design-package/` with a provenance table
of every received file (two SVG derivatives and the web font excluded, by
the audit gate's PNG-only image policy and because native bundles the
static faces; their hashes are recorded).

### What the package proved before anything was edited

- The five TTFs are real static instances: OS/2 weight classes 400, 500,
  600, 700, 800, unique family names `Manrope400`…`Manrope800`, no `fvar`
  axis to alias through. Bytes match the package manifest.
- The mark is the exact 512 × 460 RGBA asset, 84.8 % transparent, all four
  corners alpha 0. Bytes match the manifest.
- `expo-font` 57.0.3 and `expo-asset` 57.0.16 were already installed
  through `expo`; `expo-font` is now declared as an exact direct dependency
  (the only dependency change; the lockfile gained one line).

### The three slices

**Slice 1 — the shared layer.** `src/ui/tokens.ts` carries the twelve
v3.0 functional colors and the same semantic interface (24 roles kept,
plus `canvas` and a paused-status pair), a theme-independent `appChrome`
(Deep Black header and navigation in both themes), layout constants, and
a type scale in which every role names its exact face AND that face's own
weight. `src/ui/fonts.tsx` registers the five faces locally through
`expo-font` under a bounded budget (3 s): past it, or on failure, the app
proceeds on system fonts at the same sizes and weights and still switches
to Manrope if the faces arrive later; the root layout holds the splash
only while loading and releases it on a ceiling of its own, so typography
can never block auth. `AppText` and the native `TextInput` in `TextField`
consume `fontFamily` explicitly (adding it to the scale alone did
nothing, as the package warned). `Screen` grew the pinned header band with
the lockup (`BrandHeader`: the mark at its natural ratio, decorative
beside the words, image hidden from assistive technology, text-only
lockup if the image fails), a canvas-colored surround for wide windows,
and the 24 / 16 gutters. `PrimaryNav` is the Deep Black bar with a filled
Honey Gold pill for the current destination. Buttons are 52-high pills,
fields 56-high squares with a real boundary, panels 16-radius, focus a
3-unit ring outside the control. `app.json` carries the v3.0 colors and a
color-only adaptive-icon background. Verified before slice 2: typecheck 0;
the UI, navigation, shell, accessibility, and view suites green.

**Slice 2 — Home and Requests.** Rows separated by thin rules replace the
boxed cards: title, exact status, attention, next action, owner, dates,
and on Requests a chevron and the due date in the strong caption. Every
prop, handler, testID, status word, date formatter, recorded-through line,
and Refresh control is as before. Verified before slice 3: the dashboard,
requests, accessibility, and both contract suites green.

**Slice 3 — everything else.** Request detail (owner and dates as a small
table, each row one accessible item), Activity (accent dot, quiet rules),
Help (sections on rules), Account (the access text as a heading and body,
as the direction shows), sign-in (the lockup now carries the name, so the
title greets: "Welcome to HIVE", one line for Stacie), the code and
authenticator screens (the setup key on the filled info panel), and the
workspace chooser (rows with a chevron, still a radio group selected by
membership id). The native icon set is DERIVED from the unchanged mark by
`scripts/brand-icons.mjs` — pure Node, no image library — and
`tests/scripts/brand-icons` holds the tree to that derivation; the
adaptive foreground keeps every cell tip inside Android's safe circle. The
splash stays imageless (color only) with its plugin in place; a splash
image and the store masters wait for platform asset QA.

### Decisions taken against the reference, each measured

- Dark danger and success text use derived shades (`#F0A9A2` 9.70:1,
  `#A9CFA9` 10.84:1) rather than the reference's Warm Paper, so an error
  line still reads as one at a glance; the words carry the meaning either
  way. A paused status has its own quiet pair (6.72:1 / 8.55:1) rather
  than the solid Error panel, which stays for real problems.
- `textDisabled` is Muted Copy / Sage as the reference proposes; disabled
  controls also drop to 55 % opacity, as before.
- The specimen label "Design preview · Synthetic data" is presentation
  copy on the mockups, not product copy, and is not rendered.
- The Account "Your access" notice became a heading and body (the
  direction's composition); the words are unchanged.

### Find 40 — a flow tapped a label the wording commit had renamed

`quarantine-recovery.yaml` still tapped 'Reset secure sign-in data' after
`ca96181` renamed the button to 'Reset sign-in on this device'.
`maestro:validate` proves testIDs against the sources but not quoted text
selectors, so the rename slipped past it, and the 18-flow rerun at
`ca96181` running on desktop 2 as this is written will fail that flow at
the tap. Fixed here (the tap now names the current label). Owed: a
validator check that every plain-text selector in a flow occurs in the
sources or the seed, or a testID on that button and a switch to it.

### Gates at this head

typecheck 0; eslint `--max-warnings 0` clean; prettier clean (the
received package documents are excluded, being kept byte-exact); jest
**481 across 37 suites** (new: fonts — bounded load, budget, late arrival,
explicit `fontFamily` on text and input; brand header — natural ratio,
hidden image, text fallback; contrast and tokens rewritten for v3.0 with
every functional pair measured; navigation's filled pill); node:test
**369** (new: brand assets held to the manifest with OS/2 weights, mark
transparency, v3.0 colors in app.json and tokens; icons held to the
derivation); `maestro:validate` OK (18 flows); `config:check` OK;
`audit:gate` OK; `secrets:scan OK` with the ratification record supplied
out of band.

### Not evidence, and owed

- **No screenshots yet.** This environment has no emulator or simulator.
  The device lane is desktop 2: a follow-on session pulls this head, runs
  the app on the API 35 emulator over Metro (fonts and the mark load at
  runtime, no native rebuild needed for the restyle), captures light and
  dark, 200 % text, and the offline and error states, and reruns the flows.
  The icon and color changes in `app.json` show only after a native
  rebuild (`expo run:android`), which is the second desktop task.
- iOS rendering of the faces (font traits, safe areas) is unverified: no
  Mac, no Expo account.
- TalkBack and VoiceOver passes, landscape, 320-wide, and tablet remain
  device items. The store icon masters from the vector source, mask
  previews, and the splash image are platform asset QA, HOLD.
- This is a design checkpoint on the local synthetic lane. It is not
  native release readiness: production configuration, signing, submission,
  and live data stay HOLD.

## 2026-09-07 — desktop 2, fourth run: all 18 flows at `ca96181`, 15 of 18; finds 40 and 41

The desktop session ran the three runners and the twelve individual flows
in dependency order at `ca96181` (Pixel 8 emulator, API 35; Metro and the
emulator untouched; airplane mode confirmed disabled after every one of
the fifteen sweep runs; no run roots or helper ports left behind). Its
report reached this session as a peer message — the coordinator's listed
name did not carry the prefix the runbook told it to look for, so it sent
the report to the only running HIVE cloud session — and a copy is committed
by the follow-on desktop session as
`security/evidence/2026-09-07-desktop2/lanes-report-3-at-ca96181.md`.

**15 PASS.** `maestro:enroll` (reset → enroll → staff sign-out → login on
the same factor → revoke; helper terminated, clipboard scrubbed, artifacts
confined and removed), `maestro:confinement` (the QR-bearing failure
artifact confined to the private run root and scrubbed), and the sweep:
sign-in (three times), requests, activity-and-help, nav-persistence,
read-surfaces-offline, scope-switch, offline, sign-out, reinstall,
clipboard-scrub, expired-session — every step COMPLETED, exit 0. The
wording commit's changed assertions (the `sign-in-email` landmark, the
deduplicated chooser row, the new notice text) all held on the device.

**3 FAIL, three different causes.**

1. `quarantine-recovery`: `Tap on "Reset secure sign-in data"... FAILED`
   — find 40, the tap label the wording commit had renamed; the quarantine
   screen itself rendered and the new title assertion COMPLETED. Fixed at
   `3898ea5`.
2. `accessibility-smoke`: Maestro's Android driver did not start within its
   timeout (`AndroidDriverTimeoutException`, driver port 57077) before
   `Running on Pixel_8` or any step; the very next flow started the driver
   and passed. Infrastructure, transient, not retried under the run's
   rules; the flow's assertions were not exercised at `ca96181` and are
   owed on the next run.
3. `read-surfaces-denied` inside `maestro:denied`: the flow's second step,
   `Assert that "Choose a workspace" is visible`, failed immediately after
   `launchApp` following a sign-in that had reached the dashboard. The
   revoke was never reached; the runner restored and verified the
   membership and scrubbed the artifact tree on its exit path, as designed.
   Nine sweep flows launch exactly the same way and every one of them
   COMPLETED that step, so this is the cold-boot race find 31 named — a dev
   build fetches its bundle on launch and a bare assertion does not wait
   long enough — surfacing in the one flow that runs straight after a fresh
   bundle. Find 41.

### Find 41 — a bounded wait after every launch, not only in sign-in

`sign-in.yaml` waits up to 30 s for its landmark after a cleared launch
(find 31); the other flows asserted the workspace chooser right after
`launchApp` with a bare `assertVisible`. All nine now use
`extendedWaitUntil` (30 s) for that first landmark: activity-and-help,
expired-session, nav-persistence, offline, quarantine-recovery,
read-surfaces-denied, read-surfaces-offline, requests, scope-switch. The
four chooser assertions that follow an in-app transition (a scope switch,
a code submit) stay bare: the app is already running there.
`maestro:validate` OK (18 flows).

Owed on the device: `accessibility-smoke`, `quarantine-recovery`, and
`maestro:denied` at a head carrying finds 40 and 41, alongside the design
screenshots.

## 2026-09-07 — desktop 2, design lane at `3898ea5`: screenshots captured; finds 42 and 43

The follow-on desktop session pulled `3898ea5`, confirmed `expo-font`
57.0.3 resolved, and proved the restyled app on the Pixel 8 emulator over
Metro with no native rebuild: `sign-in.yaml` exit 0, 15 of 15 steps, in
light, in dark, and at 200 % text. It then captured **27 screenshots**
(540 × 1200, halved from the device) into
`security/evidence/2026-09-07-desktop2/screenshots/`: light 01–08 (Home,
Requests, request detail, Activity, Help, Account, Home offline, sign-in
with the session-ended notice), dark 01–07, dark at 200 % 01–06, light at
200 % 01–06 — synthetic data only, no authenticator screen. The lanes
report for run 4 sits beside them. All of it is committed on the desktop
as `77f9e2a` on top of `3898ea5`; the push was refused because origin had
moved to `b3a58b7`, and that session's rules forbade a rebase, so landing
it is a follow-on desktop task (rebase its own single commit, push, never
force). The clean-checkout copy of that evidence therefore lags this
record by one desktop round.

Also proven on the rebuilt binary (see find 43): boot, reaching the local
stack, and sign-in, 15 of 15.

### Find 42 — flows are not scale-independent

At 200 % text the request detail's "Back to requests" control sits below
the fold, and Maestro's tap-by-id does not scroll, so the ad-hoc tour
failed there (twice, dark and light) while everything above the fold
captured fine. The repo's own `requests.yaml` would hit the same wall, and
so would the Account screen's controls and the quarantine button. Every
flow that taps a control which can sit below the fold now brings it into
view first with `scrollUntilVisible` (completes at once when the control
is already visible): request-detail-back, settings-switch-scope,
settings-sign-out, settings-back, and the quarantine reset button.
`maestro:validate` OK. Re-proof on the device is owed with the next run.

### Find 43 — a stale generated project silently ignores `app.json`

`npx expo run:android` reused the gitignored `android/` directory from
2026-09-03 rather than regenerating it: `BUILD SUCCESSFUL in 26s`, the app
installed and signed in, and the launcher still showed the old pale
placeholder icon. `colors.xml` in that directory carried the v2.0
`#F4E4CD` and the launcher foreground was the 803-byte placeholder, while
`app.json` and `assets/images` carried the new values. So that rebuild
proved build, install, boot and sign-in only — not the icon, splash, or
colors. Runbook (README): after any change to `app.json`, `assets/images`
or `plugins/`, run `npx expo prebuild --platform android --clean` before
`expo run:android`. Owed on the device: the clean regeneration, the
launcher capture, and the three flows at the head carrying finds 40 and
41 (`maestro:denied`, `accessibility-smoke`, `quarantine-recovery`).

### Two observations that are not defects

- An ad-hoc offline check that returns to Home by the nav shows the
  already-loaded dashboard; only a fresh read shows the offline state,
  which is exactly the fail-closed policy (no background polling, no
  stale content presented as current). The repo's own offline flows
  trigger a fresh read, and the offline screenshot was taken that way.
- One `expired-session` run died mid-flow with Maestro's adb transport
  (`grpc UNAVAILABLE`), the device healthy immediately after; a fresh
  sign-in and rerun passed 12 of 12. Transient tooling, like the driver
  start-up timeout in run 4.

## 2026-09-07 — the design evidence is on the branch; a clean prebuild proves the icon; find 44

The follow-on desktop session rebased its single evidence commit onto
`8732561` and pushed it as `1aa3bee`, then added the launcher capture as
`d69ab64`. `security/evidence/2026-09-07-desktop2/` now holds the lanes
report for run 4, a README describing every capture and command, and 28
PNGs (the 27 design screenshots in light, dark, and 200 % text, plus the
launcher). Pulled here: all 28 are PNG, `audit:gate` OK (no prohibited
assets), `secrets:scan OK`, prettier clean.

**The icon and colors are proven.** `npx expo prebuild --platform android
--clean` regenerated the native project: `colors.xml` carries
`#F3F2EA` and `#111310` and no v2.0 value, the launcher mipmaps are the
derived mark (15,711 bytes at xxxhdpi against the 803-byte placeholder),
and the debug manifest still carries the loopback network security config.
`npx expo run:android`: `BUILD SUCCESSFUL in 1m 11s`, installed and
launched. The launcher shows the gold honeycomb mark on a dark circle; the
system splash is Warm Paper with the mark on a Soft Black circle (Android
12+ draws the launcher icon on an imageless splash, which is exactly the
configuration). Find 43 closed.

**First device evidence of the lockup on the rebuilt binary.** Outside
Maestro, `uiautomator` listed `sign-in-screen`, `brand-header`,
`brand-mark`, `brand-wordmark`, `sign-in-email` and `sign-in-submit` on the
freshly built app: the header band with the mark and wordmark renders on
the device.

### Find 44 — a clean prebuild stalls the running Metro

Every flow failed at its first launch wait after the clean prebuild — not
the app: the Metro that had been serving since 14:52 (started by an
earlier `expo run:android`) was left with one thread pinned at 100 %,
`/status` answering in 15–33 s, and bundles arriving six minutes after
launch, once `android/` had been replaced underneath it. `sign-in.yaml`
therefore failed three times at `sign-in-email` after its 30 s wait, and
`maestro:denied`, `accessibility-smoke` (its failure screenshot was the
splash) and `quarantine-recovery` failed the same way. Transport evidence,
not app evidence: finds 40 to 42 remain unverified on the device. Runbook
(README): restart Metro after any clean prebuild. A desktop session with
explicit authority to stop and restart Metro reruns the four flows next.

## 2026-09-07 — after the Metro restart: finds 40 to 42 device-confirmed; finds 45 and 46

A desktop session with explicit authority to restart Metro identified the
stalled process by its command line (the `expo run:android` of 14:52),
measured `/status` at 15.80 s, stopped it, and started a fresh Metro
(`CI=1`, `EXPO_PUBLIC_QA_HOOKS=1`, port 8081): `/status` 0.0065 s, first
bundle `839ms (1688 modules)`. Find 44 confirmed. The four flows at
`f44a200`, on the clean-prebuild binary (evidence `1e12681`, `07b1372`:
`security/evidence/2026-09-07-desktop2/flows-after-metro-restart.md`):

| Flow                  | Result                                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------ |
| `sign-in` (twice)     | **PASS**, exit 0, 15 of 15 steps, both runs                                                      |
| `maestro:denied`      | **PASS**, `maestro:denied OK`: chooser wait, mid-flow revoke, stale scope shown, no stale row    |
| `quarantine-recovery` | **PASS**, exit 0, 16 of 16: scroll-into-view, then `Tap on "Reset sign-in on this device"`       |
| `accessibility-smoke` | FAIL at `"Email" is visible`: launched onto the signed-in chooser the denied lane left (find 45) |

Finds 40 (the renamed label), 41 (the bounded chooser wait, inside the
denied runner where it first failed) and 42 (the scroll before a
below-the-fold tap) are confirmed on the device.

### Find 45 — accessibility-smoke launched into whatever the lane before left

The flow used a bare `launchApp` and asserted the sign-in screen; after the
denied runner, which restores the membership and leaves the app signed in,
it met the workspace chooser instead (the dump showed `select-scope-screen`
and `brand-wordmark`, so "HIVE" passed and "Email" failed). Same class as
find 31's fix for `sign-in.yaml`: the flow now launches with
`clearState: true` and waits up to 30 s for `sign-in-email`.
`maestro:validate` OK. This flow has now failed three times on the desktop
at v3.0 heads for three unrelated reasons (driver start-up timeout, the
stalled Metro, this) and has never passed there; it is first in line on
the next run.

### Find 46 — unhandled rejections during the quarantine transition (low)

While `quarantine-recovery` ran, Metro logged `Auto refresh tick failed …
QuarantineRequiredError: Secure storage requires quarantine: corrupt` and
three `Uncaught (in promise) QuarantineRequiredError` rejections raised
from `SessionStorageAdapter#readInternal`, one later reported handled. The
UI did exactly what it must (quarantine screen, no protected UI, scrub the
only exit), so this is log hygiene rather than a control gap: the refresh
tick and any reader racing the quarantine transition should catch
`QuarantineRequiredError` explicitly. Owed as a red-green change in the
auth path (test the race first, then the minimal catch), not done here.
No secret or identity content was in the log — only the error class and
the code `corrupt`.

Harness note for desktop sessions: under PowerShell 5.1,
`Invoke-WebRequest -UseBasicParsing` returns Metro's `/status` body as
bytes; a readiness poll must decode it before matching
`packager-status:running`.

### Device lane at the design heads

At `f44a200` on the clean-prebuild binary: sign-in, `maestro:denied`,
`quarantine-recovery` PASS. At `ca96181`: 15 of 18 with the three causes
above. Owed: one full 18-flow sweep at a head carrying finds 40 to 45, so
the design checkpoint stands on the whole lane rather than on its parts.

## 2026-09-07 — desktop 2, run 5: the full lane at `bd2be6c`, 14 of 18; finds 47 and 48

The whole lane at the head carrying finds 40 to 45, on the clean-prebuild
binary with the fresh Metro (`/status` 0.042 s): evidence `3b6573c`
(`security/evidence/2026-09-07-desktop2/full-lane-at-find-45.md`).

| Flow                                                                                                                                                                                                                 | Result                                                   |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| sign-in (three sweep runs and inside the denied runner), requests, activity-and-help, nav-persistence, read-surfaces-offline, scope-switch, offline, sign-out, clipboard-scrub, quarantine-recovery, expired-session | **PASS**, every step COMPLETED, exit 0                   |
| accessibility-smoke                                                                                                                                                                                                  | **PASS** — its first pass on this desktop (find 45 held) |
| confinement-probe (`maestro:confinement`)                                                                                                                                                                            | **PASS**, `CONFINEMENT PROOF OK`                         |
| read-surfaces-denied (`maestro:denied`)                                                                                                                                                                              | **PASS**, `maestro:denied OK`                            |
| mfa-enroll (`maestro:enroll`)                                                                                                                                                                                        | FAIL at `Tap on id: mfa-code-label` after the wrong code |
| mfa-login, staff-sign-out                                                                                                                                                                                            | NOT RUN — the enroll runner stopped before them          |
| reinstall                                                                                                                                                                                                            | FAIL — native SIGSEGV in the app process on launch, once |

Every scroll-into-view guard from find 42 ran (`Scrolling DOWN until
… COMPLETED` before request-detail-back, settings-back,
settings-switch-scope, settings-sign-out and the quarantine button), and
the enroll runner's cleanup ran to completion on its failure path
(clipboard overwritten, factor revoked and verified clean, artifact tree
scrubbed).

### Find 47 — under the keyboard, the code field's label left the visible hierarchy

`mfa-enroll.yaml` blurred the code field by tapping its label (find 37's
replacement for `hideKeyboard`) so the verify control would come out from
under the soft keyboard (find 30). At `ca96181` that worked; at the 2026
design's head the label was `Element not found` right after the wrong code
was typed. The label still carries its testID (`labelTestID` on
`TextField`, rendered on the label text; the primitives test proves it),
and the same tap had passed before the enrollment screen grew a larger
title, a filled setup-key panel and the header band, so the label is off
the visible area under the keyboard rather than missing — the runner's
confinement scrubs its own artifacts, so this is inferred, not seen. The
mechanism was fragile either way: it depended on where the keyboard left
the scroll. The three MFA flows now bring `mfa-submit` itself into view
with `scrollUntilVisible` before every verify tap (completes at once when
already visible), the validator's `hideKeyboard` refusal points there, and
the gate test pins the new shape. `labelTestID` stays. Owed: the enroll
runner (which covers mfa-enroll, staff-sign-out, mfa-login) at this head.

### Find 48 — one native crash on a clear-state launch (open)

`reinstall.yaml`'s cleared launch never reached the sign-in screen: the
device log shows `Fatal signal 11 (SIGSEGV) … fault addr 0x10` in thread
`FrescoLightWeig` (Fresco's lightweight image-pipeline executor) 0.4 s
after `Running "main"`, inside ART interpreter frames with
`kotlin.SynchronizedLazyImpl.getValue` the only named Java frame; Maestro's
screenshot showed the launcher. One occurrence in nine cleared launches
that session (the other eight, in the runners and the sweep, booted
normally), Metro healthy, emulator image `sdk_gphone16k` (16 KB pages,
Android 15). The design added the app's first native `Image` (the mark in
the header), so Fresco now runs at every boot; whether this is an ART
fault on the 16 KB-page image or an image-decode race is not established.
Open, not fixed: the next desktop run launches `reinstall.yaml` three times
with the crash log buffer captured after each, so a recurrence carries a
readable backtrace. Until then this is a single unexplained crash, not a
verdict on the lane.

## 2026-09-07 — desktop 2, run 6: find 48 not reproduced; find 47's fix was not enough

Evidence `e970016`
(`security/evidence/2026-09-07-desktop2/enroll-and-reinstall-at-find-47.md`),
at `e92c133`, on the clean-prebuild binary with the fresh Metro
(`/status` 0.044 s).

- **`reinstall.yaml` three times: PASS, PASS, PASS**, every step
  COMPLETED, the device crash buffer empty after each. Find 48 stands at
  one native crash in twelve cleared launches across two sessions and
  none at this head. Still open, still unexplained, no longer a lane
  blocker.
- **`maestro:enroll`: FAIL** at the new step, `Scrolling DOWN until id:
mfa-submit is visible … FAILED — No visible element found`, at the
  same moment as run 5 (immediately after the wrong code is typed). In
  run 5 the label ABOVE the field could not be found; now the control
  BELOW it cannot be found even after scrolling for 20 s, while the
  field itself takes taps and text. The runner's cleanup ran (helper
  terminated, clipboard scrubbed, factor revoked and verified clean,
  artifact tree removed), which by design also destroyed Maestro's
  failure screenshot and hierarchy — the enrollment screen shows the QR
  and the setup key, so no artifact of it may ever be retained. staff-
  sign-out and mfa-login again NOT RUN.

So find 47's diagnosis (the label out of view) was incomplete: with the
keyboard open on this long screen, nothing below the field can be
brought into view either. The consistent explanation is the keyboard
handling itself. This app targets Android 15 edge-to-edge, no
`softwareKeyboardLayoutMode` is set (Expo's default is `resize`), and no
edge-to-edge helper is installed; under edge-to-edge the window is not
resized for the keyboard unless the app applies the IME inset itself, so
the scroll view keeps its full-height viewport, the keyboard overlays
its lower part, and a control that sits under the keyboard at maximum
scroll can never be scrolled out from under it. The sign-in and code
screens escape this because their controls sit near the top of the
page; the enrollment screen, with the QR and the setup-key panel above
the field, does not — and at `ca96181` the label tap happened to land
above the keyboard line. This is a product defect as much as a flow one:
a person on that screen must dismiss the keyboard by BACK to reach the
verify control. Recorded as find 49, pending a measurement: a desktop
probe on the sign-in screen (no secrets) records the root view and the
control bounds before and after the keyboard opens, which settles resize
versus overlay before any code changes.

### Find 49, measured and fixed — the keyboard is an overlay under edge-to-edge

The read-only desktop probe on the sign-in screen (no secret on it) took
the node bounds before and after the keyboard opened, on the Pixel 8
emulator at 1080 × 2400, 420 dpi. Nothing moved: the root content frame
stayed `[0,0][1080,2400]`, the header band stayed at y 74–295, the scroll
view at 295–2400, the email field at 742–889 and the "Send code" control
at 952–1089, while the IME reported `mInputShown=true` with its inset
frame at `[0,1517][1080,2400]` (883 px). The app window asks for
`adjust=resize`, and under edge-to-edge the framework does not shrink the
frame — OVERLAY, not resize and not pan. Sign-in works only because its
control's bottom (1089) happens to sit above the keyboard's top (1517);
on the enrollment screen the verify control sits below that line at
maximum scroll, and a scroll view that never grew by the inset cannot
bring it out. React Native 0.86's root view confirms the mechanism in
source: it emits `keyboardDidShow` with the IME inset height and applies
nothing.

Fix, in the shell so every screen gets it: `Screen` wraps its content in
a `KeyboardAvoidingView` in `padding` mode. That view measures its own
frame and pads its bottom by the measured overlap with the keyboard, so
the scroll view shrinks to the keyboard's top edge and any control can be
scrolled above it; on a platform that does resize the window the overlap
is zero and nothing doubles. The container starts below the header band
at the window origin, so no vertical offset is needed. Structural jest
test (the container measures itself and carries the padding channel; the
scroll view sits inside it, the lockup outside). Gates at this head:
typecheck 0, eslint 0, prettier clean, jest **485 across 38 suites**.
Device proof owed: `maestro:enroll` (the verify tap under the keyboard,
and with it mfa-login and staff-sign-out) and `sign-in.yaml`, at this
head, on the desktop.

### Find 49, second iteration — the avoiding view padded by zero on the device

Run 7 at `fc1de67` (evidence `631f58b`,
`security/evidence/2026-09-07-desktop2/enroll-at-find-49.md`): sign-in
PASS on the new bundle (16 of 16), `maestro:enroll` FAIL at the same
`scrollUntilVisible mfa-submit` step, crash buffer empty. The session's
read-only diagnostics showed the served bundle carried the container
(`screen-keyboard-room`, six `KeyboardAvoidingView` references) and no
JavaScript warnings, and that with the keyboard up the scroll view still
spanned `[0,295][1080,2400]` — the container measured a zero overlap.

The cause is in React Native's Android root view: for a window declared
`adjustResize` it reports the keyboard's `screenY` as the bottom of the
"visible display frame", on the assumption that the window shrank. Under
edge-to-edge it did not, so `screenY` equals the container's bottom and
`KeyboardAvoidingView` computes no overlap, while the event's `height` is
right (the IME inset less the navigation-bar inset). The shell therefore
no longer trusts `screenY`: it listens to the keyboard events itself,
measures the container's bottom edge from its own layout (the shell's
outer view sits at the window origin, as the probe showed), takes the
keyboard's top as the window's bottom minus the reported height (minus
the navigation-bar inset on Android, which the height excludes), and pads
by the part of the container below that edge — zero on any platform that
does resize the window. `keyboardRoomFor` is a pure exported function
with its own tests (the emulator's numbers, a footer below the container,
the hidden and resized cases, iOS), and an event-level test drives the
listeners and the layout and checks the padding appears and clears.
Gates: typecheck 0, eslint 0, prettier clean, jest **490 across 38
suites**, node:test 369. Device proof owed again: `maestro:enroll` and
`sign-in.yaml` at this head.

## 2026-09-07 — find 46 closed: the storage bridge absorbs a quarantine the auth library meets on its own

Find 46 (recorded after the Metro-restart run) was owed as a red-green
change in the auth path: while `quarantine-recovery` ran, Metro logged
`Auto refresh tick failed … QuarantineRequiredError` and three
`Uncaught (in promise) QuarantineRequiredError` rejections raised from
`SessionStorageAdapter#readInternal`. The UI did what it must; the log did
not. The readers that met the error are the auth library's own — its
recovery read at construction, the initial-session emitter behind
`onAuthStateChange`, the refresh tick, and the token lookup inside every
data call — and none of them can be taught to catch it: the tick logs and
continues, the emitter is never awaited, and the library's process-lock
chain carries each rejection until the next lock acquisition attaches a
handler (the "one later reported handled" in the log). The one seam we
own between those readers and the adapter is the storage bridge in
`src/data/supabase/client.ts`, so that is where it is handled.

**Red first.** A new suite drives the REAL pinned library
(`src/data/supabase/__tests__/quarantine-bridge.test.ts`, no network: a
stored session an hour from expiry is never refreshed). Before the change
it reproduced the device symptom inside jest: constructing the client over
a corrupt store surfaced an unhandled `QuarantineRequiredError` from the
library's own initialization, and the refresh tick meeting a fresh
corruption went to `console.error` with nothing reaching the controller.
The bridge and controller suites gained their cases the same way (13 new
tests red, then green).

**The change.** The bridge absorbs the first `QuarantineRequiredError` a
session read or write raises: it closes the bundle's write gate (no later
read or write reaches the adapter), reports the error once through the
bundle's new `BundleEvents.onStorageQuarantine`, and shows the library "no
session" — so the library's readers see nothing to log or reject. The
controller never sees that false "no session": every controller-facing
gateway call (`getSession`, `requestOtp`, `verifyOtp`, the TOTP calls,
`signOutRemote`) re-raises the absorbed error when it settles, whether the
library call succeeded or failed for another reason, because storage
trouble outranks every other classification (review P2-5). The existing
quarantine catch sites therefore fire exactly as before. The reported
event takes the same `STORAGE_FAILURE` transition from whatever state the
controller is in — clearing actor-bound state with reason `quarantine`,
dropping any pending email or factor — serialized behind the in-flight
operation (so a controller call that meets the same failure wins and the
report becomes a no-op), and discarded with `auth_epoch_stale_event` when
it carries the epoch of a bundle a sign-out or scrub has since disposed.
Deletions are not absorbed: the controller's own read-back-verified
deletion is the authority there, and a failed library-side removal still
reaches it as the revocation failure it always was. `ClientLifecycle`
hands the events to the bundle factory at creation because the library
reads the store the moment it is constructed; the runtime and the
live-bridge lane wire `onQuarantine` through, and any factory that never
reports may ignore the argument.

One deliberate behavioural consequence: a store that turns unverifiable
while the app is signed in (the QA hook's corruption, or a keystore going
bad under a running app) now moves the app to the quarantine screen at the
next library read — the refresh tick within 30 s — instead of serving
protected UI over a corrupt store until the next launch. The
`quarantine-recovery` flow is unaffected: it asserts after `stopApp` and
relaunch, and boot lands on quarantine either way.

Files: `src/data/supabase/client.ts` (bridge, `raisingQuarantine`,
bundle events), `src/auth/client-lifecycle.ts` (`BundleEvents`),
`src/auth/controller.ts` (`reportStorageQuarantine`),
`src/app-runtime.ts`, `tests/live/journeys.ts`,
`docs/auth-state-machine.md`; tests in `bridge.test.ts` (six cases:
absorb on read, never touch the adapter again, re-raise, absorb on write,
other errors untouched, deletion passes through),
`quarantine-bridge.test.ts` (two cases against the real library),
`controller.test.ts` (five cases: from authorized with refresh stopped and
scoped data cleared, from a pending sign-in, a second report absorbed, a
stale-epoch report ignored, scrub still lands on signed_out(scrubbed) with
a fresh client). Gates at this head: typecheck 0, eslint 0, prettier
clean, jest **503 across 39 suites**, node:test 369.

Device proof owed: `quarantine-recovery.yaml` at this head with Metro's
log clean of `Auto refresh tick failed` and `Uncaught (in promise)`; it
joins the enrollment rerun on the desktop's list.

## 2026-09-07 — desktop 2, run 8: find 49's second iteration measured at zero; the third iteration observes first

Run 8 at `4c6c625` (evidence `b6cc9ea`,
`security/evidence/2026-09-07-desktop2/enroll-at-find-49b.md`), on the
warm bundle with `keyboardRoomFor` confirmed in the served source.

**The measurement.** On the sign-in screen (window 1080×2400 px at
density 2.625), the window manager put the keyboard at `frame=[0,1517]
[1080,2400]`, inset `bottom=883` — 336 dp, exactly the figure the fix was
derived from. With it shown, and again 20 s later, the shell's scroll view
still spanned `[0,295][1080,2400]` and `sign-in-submit` stayed at
`[63,952][1017,1089]`: the second iteration produced **zero** room on the
device, like the first. The keyboard-room wrapper is a plain view and does
not appear in the accessibility dump, so only the scroll view it wraps is
observable; it did not shrink.

**The lane.** `maestro:enroll` FAIL (exit 1) at the same step as runs 6
and 7 — `scrollUntilVisible id: mfa-submit` after the wrong code, the
first 14 steps of `mfa-enroll` COMPLETED — with the runner's exit path
whole (clipboard scrubbed 3/3, factor revoked and verified clean, artifact
tree scrubbed) and the crash buffer empty. `sign-in.yaml` FAIL twice for
an infrastructure reason: the emulator's low-memory killer (2.4 GB) killed
Maestro's on-device driver mid-flow (`DeviceServerDiedException`, the
first such death in nine runs on this desktop); the same first 14 steps
passed inside the runner minutes later. The session's bounded attempt to
attach to the Hermes inspector to read the event from outside failed on
the dev-middleware origin check and an immediate close. It changed no
file.

**Why a third derivation is not the next step.** Both iterations rest on
the same premise — that `keyboardDidShow` reaches JavaScript on this
edge-to-edge window with a usable height — and no run has observed that
event; the shell's math is unit-tested against the numbers the source
promises, and the device disagrees with the outcome. Reading React
Native 0.86.3 again: the root view emits the event from its global-layout
listener using the IME inset less the bar inset, a bridgeless surface view
registers that listener when attached, and the Android framework requests
a layout on every inset change — so the event should fire. Nothing in the
core applies the IME inset itself under edge-to-edge (its Android
`SafeAreaView` is a plain view in JavaScript, and `react-native-safe-area-
context` 5.7.0 excludes the keyboard), so the shell's own room is still
the right shape of fix; what is missing is the observation.

**Find 49, third iteration — the observation.** A production-inert seam
in the shell (`src/ui/primitives/keyboard-room-probe.ts`) receives every
input of the computation — platform, window height, measured container
bottom, keyboard height, bottom inset, and the room — and a QA-build hook
(`src/dev/qa-keyboard-hook.ts`, marker `HIVE_QA_KEYBOARD_HOOK`) logs those
samples and every `keyboardWillShow`/`DidShow`/`WillHide`/`DidHide` event's
end coordinates with the window and screen sizes, geometry only, to the
console — which a development build forwards to logcat under
`ReactNativeJS`. The hook follows the other two exactly: behind the
`__DEV__` + `EXPO_PUBLIC_QA_HOOKS` guard in `app/_layout.tsx`, resolved to
an inert stub by `metro.config.js` in any non-QA graph, its marker added
to `bundle:inspect`'s qa-hook-marker pattern and to that pattern's test.
Tests: the hook's line formats and its install/remove behaviour (three
cases), the shell's reporting through the seam (one case). No behaviour
of the shell changed. Gates at this head: typecheck 0, eslint 0, prettier clean, jest **507 across 40 suites**, node:test 369, `maestro:validate` OK (18 flows).

**Next desktop run (no rebuild; the bundle reload is enough):** pull,
restart the app, wait for the sign-in screen, tap `sign-in-email`, wait,
`adb logcat -d -s ReactNativeJS` filtered on the marker, dismiss the
keyboard, report the lines verbatim (they carry numbers only). The lines
decide the third iteration: no event at all points to a native inset
listener; an event with a sane height and a nonzero room points at the
render of the padding; a zero or absent height points at the root view.

Also owed on that desktop: `quarantine-recovery.yaml` at a head carrying
find 46, with Metro's log clean of `Auto refresh tick failed` and
`Uncaught (in promise)`. The emulator's RAM allocation is Kody's call; the
lane will keep meeting the low-memory killer at 2.4 GB on clear-state
launches.

## 2026-09-07 — desktop 2, run 9: the keyboard room works on the device; find 49 device-confirmed on the sign-in screen; find 50 (runbook)

Run 9 at `724c9fc` (evidence `eb425a1`,
`security/evidence/2026-09-07-desktop2/keyboard-hook-at-724c9fc.md`): the
observation the third iteration was built for, and with it the answer.

**The event fires, the numbers are right, the scroll view shrinks.** On
both taps into `sign-in-email` the hook logged
`event=keyboardDidShow height=312 screenY=578` (window 411×914 dp; the
keyboard's 883 px is 336 dp, and 312 is that less the 24 dp navigation
bar the height excludes, exactly as `keyboardRoomFor` assumes), followed
at once by `room … containerBottom=914 keyboardHeight=312 bottomInset=24
room=336`. The uiautomator dump with the keyboard up shows the shell's
scroll view at `[0,295][1080,1518]` against the IME frame top of 1517 px
(336 dp × 2.625 = 882 px); the wrapper itself keeps its bounds (it pads);
`keyboardDidHide` restored `room=0` both times; no `keyboardWillShow`
lines on Android, as expected. `containerBottom` was 914 on every line but
one transient `null` during launch. Find 49 is therefore
**device-confirmed on the sign-in screen at the second iteration's
computation** (`4c6c625`'s shell, unchanged by the third iteration beyond
the reporting seam); the enrollment flows that first exposed it are the
remaining proof.

**Why runs 7 and 8 measured zero (find 50, runbook).** The first launch of
run 9 showed no `installed` line at all: the previous Metro process,
after a 20-file pull, served a **one-module delta** and printed `Detected
a change in metro.config.js. Restart the server to see the new results.`
A runbook restart (`Start-Process cmd /c set CI=1&& set
EXPO_PUBLIC_QA_HOOKS=1&& npx expo start --port 8081`, `/status` ready in
four tries) produced a full 1690-module bundle in 3.7 s and the hook
appeared. So the bundle that run 8 measured cannot be shown to have
carried the second iteration, and `screen-keyboard-room` — absent from
run 8's dump, present in run 9's under the same testID — says it very
probably did not. Runs 7 and 8 measured a stale bundle; the second
iteration was right on the first day. Recorded as find 50 in the README's
Android runbook: after any pull, treat a `(1 module)` bundle line right
after a multi-file pull as a stale bundle and restart Metro; a pull that
touches `metro.config.js` always needs the restart.

**Not run:** the enrollment runner, sign-in and `quarantine-recovery`
(find 46's device proof). The task's memory gate (300 MB in `free -m`
after the observation; the emulator showed 140 MB) held them back. That
gate measured the wrong column: `dumpsys meminfo` a minute later reported
1.0 GB free including cache, and Android's low-memory killer acts on
pressure, not on `free`'s first column. Run 10 uses `dumpsys meminfo`'s
free figure (≥ 600 MB including cache before each flow) and treats a
`DeviceServerDiedException` as the infrastructure failure it is (rerun
once, recorded). The emulator's 2.4 GB allocation stays Kody's call.

The QA keyboard hook stays: it is production-inert by the same three
proofs as the other hooks, and it gives the device lane a permanent
observable for keyboard geometry on every screen.

Owed at this head, on the desktop: `maestro:enroll` (mfa-enroll,
staff-sign-out, mfa-login — the verify tap under the keyboard is exactly
what run 9 shows scrollable now), `sign-in.yaml`, and
`quarantine-recovery.yaml` with the logcat counts for find 46.

## 2026-09-07 — desktop 2, run 10: the enrollment runner passes twice, the quarantine flow's log is clean; finds 30/37/46/47/49 device-confirmed; the whole lane has now passed at v3.0 heads

Run 10 at `4cb6144` (evidence `35667bd`,
`security/evidence/2026-09-07-desktop2/enroll-and-quarantine-at-4cb6144.md`),
on the Metro run 9 restarted, no rebuild, no emulator change, and a
`dumpsys meminfo` memory gate that never came near its threshold (1.00 to
1.10 GB free including cache at every reading; no `lowmemorykiller` line
and no OOM kill of the app in any window — every `am_kill` was a Maestro
stop or clear-state launch).

| Flow                                         | Result                                                                                                                                                                                                                                                 |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| mfa-enroll, staff-sign-out, mfa-login        | **PASS, twice** (`maestro:enroll OK`, exit 0, 154 s and 157 s): the find 47 scroll to `mfa-submit` at 100 % visibility and the tap COMPLETED in both enroll and login; factor revoked and read back zero; clipboard scrubbed; artifact tree gone       |
| sign-in                                      | **PASS** (exit 0, 37 s)                                                                                                                                                                                                                                |
| quarantine-recovery (find 46's device proof) | **PASS** (exit 0, 30 s) with a clean `ReactNativeJS` log: 0 `Auto refresh tick failed`, 0 `QuarantineRequiredError`, 0 `Uncaught`, 0 unhandled rejections, 0 error class names of any kind; the log held only the hook's lines and two bootstrap lines |
| crash buffer                                 | 0 bytes after every flow                                                                                                                                                                                                                               |

The keyboard hook showed the room applied on every screen that raises a
keyboard: `height=312 … room=336` under the full keyboard for the email
field, `height=268 screenY=622 … room=292` under the number pad for the
OTP and TOTP fields, on the sign-in, enrollment and login screens alike,
each show answered within about 10 to 25 ms and each hide followed by
`room=0`. The shell needs no special case for the two keyboard heights.

**Finds 30, 37, 47 and 49 are device-confirmed end to end**, and **find
46 is device-confirmed**. With runs 5 (`bd2be6c`: every screen flow,
accessibility-smoke, the confinement proof, the denied runner — 14 of
18), 6 (`e92c133`: reinstall, three times clean) and 10 (`4cb6144`: the
enrollment runner's three flows, sign-in, quarantine-recovery), **every
one of the 18 flows has now passed at a v3.0 head on the device.** Find
48 stays open at one native crash in the first twelve cleared launches
and none in the roughly twenty since.

Two runbook facts from the run, both now in the README:

- Maestro's Android driver clears logcat at every flow start (the main
  buffer's earliest entry equalled the flow's launch instant in three
  separate flows, without a wrap and with no `logcat -c` anywhere in the
  repo's scripts), so a post-hoc `adb logcat -d` after the multi-flow
  runner shows only its last flow. Hook lines through the runner are
  captured by a live `adb logcat -v time -s ReactNativeJS > file` started
  before it; the supplementary pass was captured that way and reproduced
  the sign-in dump line for line.
- Find 50, refined: after a docs-only pull a fresh launch produced a
  `(1 module)` bundle line with the hook present, so that line alone is
  the normal delta when nothing in the graph changed. The stale-bundle
  signal is the missing `installed` line (or Metro's own "Restart the
  server" line); `(1 module)` is suspicious only right after a pull that
  touched JavaScript or `metro.config.js`.

The RAM-headroom question from runs 8 and 9 closes on this evidence
unless Kody wants the emulator's allocation raised for other reasons:
under the correct metric the emulator had a gigabyte to spare
throughout, and run 8's driver death remains the one such event.

**The design checkpoint stands on the whole lane.** What remains is not
device work: Stacie's review of the wording and feel (the screenshots),
the one-line "Welcome to HIVE" title decision, the real sign-in email
and support address values, the iOS lane when the account and hardware
exist, the `main` branch, store icon masters and a splash image (asset
QA, HOLD), TalkBack/VoiceOver, tablet and landscape — Kody-owned, listed
on PR #1.

## 2026-09-07 — the iOS lane opened on Kody's word: the iOS project verified at the design head; find 51, the imageless iOS launch screen

Kody: "Let's get going on iOS." What can be done without a Mac was done
first; the decisions only Kody can take are put to him at the end.

**The iOS project at today's head.** `expo prebuild --platform ios
--no-install` succeeds at the v3.0 design head (the last verification was
2026-08-26, before the design, the fonts and the icons). The generated
project carries bundle identifier `com.myhbcfo.hive.development`,
deployment target 16.4, `NSAllowsArbitraryLoads=false`, the `hivedev`
URL scheme (the QA deep links), `UIUserInterfaceStyle=Automatic` (the
dark theme), all four orientations on iPhone and iPad with
`UIRequiresFullScreen=false`, version 0.1.0 build 1, and the 1024-point
app icon — measured fully opaque (minimum alpha 255 over 1,048,576
pixels), which the App Store requires and the icon script composes over
Soft Black on purpose. The Manrope faces load at runtime through
`expo-font`, so no `UIAppFonts` entry is needed. The Maestro runners use
no Android tooling (Maestro's own flows do the clipboard scrub), so they
apply to a booted simulator as they are; `offline.yaml` stays
Android-only (`setAirplaneMode`) and `reinstall.yaml` is manual on iOS,
both as their headers say. `preflight:device` already checks Xcode and
an iOS runtime on macOS. `eas:guard` still holds the one simulator
profile. No Expo account exists, no build has been run, and nobody has a
Mac: those facts are unchanged.

### Find 51 — the imageless iOS launch screen (medium; fixed, unbuilt)

Reading the generated `SplashScreen.storyboard` found the iOS twin of
the Android imageless-splash find of 2026-08-28. expo-splash-screen's
imageless path (`removeImageFromSplashScreen`, 57.0.8) removes the image
view and nothing else: its constraint removal matches ids it never wrote
(the template's `0VC-Wk-OaO` / `zR4-NK-mVN` against sha1 ids), so the
two constraints centring the removed `EXPO-SplashScreen` view stay and
the storyboard references an object that does not exist; its resource
removal reads `existingImageIndex && existingImageIndex > -1`, which
skips index 0, so the `SplashScreenLogo` resource stays; and the
container view keeps the template's `systemBackgroundColor`, so the
`SplashScreenBackground` colour set the vendor writes into the asset
catalog — Warm Paper and Soft Black — is never referenced and the launch
screen would be plain white or black. Whether Xcode's storyboard
compiler rejects the dangling references was not tested (no Mac); the
brand colour omission is certain from the file.

`plugins/with-ios-imageless-splash.js` runs after the vendor's storyboard
mod (registered before expo-splash-screen: mods execute in reverse
registration order, the same mechanism the Android twin relies on,
confirmed in `@expo/config-plugins`' `withBaseMod`) and repairs exactly
those three things: drops every constraint referencing the absent view
(and the empty `<constraints>` element with them, as Xcode writes it),
drops the dangling image resources, and points the background at the
named colour, adding the named-colour resource with the configured light
value in sRGB and dropping the now-unreferenced system colour. It throws
when an image view is present (a splash image was configured; the plugin
must go) and when nothing is left to repair (upstream fixed itself), so
it retires loudly. `tests/scripts/ios-imageless-splash.test.mjs` holds
it against the generated storyboard verbatim (nine cases, both failure
directions), and a real prebuild here shows the result: the container
names `SplashScreenBackground`, the resource carries #F3F2EA as
`0.952941176470588 / 0.949019607843137 / 0.917647058823529`, and no
constraint, image resource or system colour remains. Compiling it is
tier 2's first act on a Mac.

**The three tiers, recorded in the README:** (1) the EAS simulator build
for compile proof — an Expo account and terms, Kody's, nothing from
Apple, no Mac; (2) a Mac with Xcode for the app running, the flows,
VoiceOver and the launch screen — no Apple account, no signing; (3) a
physical iPhone and later TestFlight — Apple Developer Program
membership and signing, HOLD until Kody authorizes it exactly. The Mac
run path is written end to end, with the iOS notes for the flows, the QA
links, the keyboard hook and the privacy manifest aggregation, and the
release-readiness items (`ITSAppUsesNonExemptEncryption`,
`NSAllowsLocalNetworking`, the Face ID string) are listed so they are
not rediscovered.

Gates at this head: typecheck 0, eslint 0, prettier clean, node:test
**378**, `config:check` OK, `eas:guard` OK, `maestro:validate` OK, jest
**507 across 40 suites**.
