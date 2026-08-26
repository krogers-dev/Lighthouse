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
