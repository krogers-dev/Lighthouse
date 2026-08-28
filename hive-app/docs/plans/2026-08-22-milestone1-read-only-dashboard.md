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

## 2026-08-28 — first Windows desktop execution: ten composition finds

The Windows desktop (item (1) above) reached a fully green
`preflight:device` — Node 22.23.2/npm 10.9.8 after displacing a
pre-existing Node 24, Docker Desktop on the WSL2 backend, Android Studio
with a Pixel_8 API 36 AVD, WHPX acceleration, 7.8 GB RAM — and the first
real execution of the device lane surfaced ten defects that no
container run could have, because no prior machine could run this lane
at all:

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
first-ever pixel evidence, closing the desktop bring-up. Outstanding
desktop evidence is now Phase 6 only: the CLI-composition e2e, Maestro
flows on the emulator, and expo-doctor 21/21.
