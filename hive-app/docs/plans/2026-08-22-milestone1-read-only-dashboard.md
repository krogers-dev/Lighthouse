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

| Lane                                     | On a Windows desktop                                              |
| ---------------------------------------- | ----------------------------------------------------------------- |
| A3 — black-box e2e through PostgREST     | **Reachable.** Docker plus Node; no Apple toolchain involved      |
| A5 — Android half, and the Android build | **Reachable.** Android Studio, an AVD with WHPX, and Maestro      |
| A5 — iOS half, and the iOS build         | **HOLD.** Needs a Mac, a hosted Mac runner, or a cloud build lane |
| Screen-reader QA — TalkBack              | **Reachable** on the Android emulator or a physical device        |
| Screen-reader QA — VoiceOver             | **HOLD.** Same hardware dependency as the iOS build               |

So the brief's "dependable iOS and Android app" has a hardware gap on the
iOS side. It is an approval and procurement question (owner Kody), not an
engineering one. `preflight:device` reports it as BLOCKED rather than as a
finding, so it stays visible on every run without training anyone to
ignore a permanent failure.

## Next

Device-lane evidence for both milestones on a machine with Docker and a
simulator, owner Kody, which is what closes A3, A5, and the hardware half
of A4 in one pass. The run path is in README.md.
