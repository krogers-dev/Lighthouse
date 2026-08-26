# Milestone 1 execution record — read-only client dashboard

Work Order 002 moved from draft to execution on Kody's instruction of
2026-08-22. Two checkpoints are complete and pushed.

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

## Gate results (2026-08-22, this container)

| Lane                                           | Result                                                                             |
| ---------------------------------------------- | ---------------------------------------------------------------------------------- |
| verify:toolchain                               | exit 0 — Node 22.23.2, npm 10.9.8, Expo 57.0.11, RN 0.86.2, React 19.2.3, TS 6.0.3 |
| lint / format:check / typecheck                | exit 0 / exit 0 / exit 0, zero warnings                                            |
| jest                                           | **331 tests**, 28 suites, all passing (276 before this milestone)                  |
| node:test script suites                        | **248 tests**, all passing                                                         |
| pgTAP                                          | **120 tests** across 7 files (86 across 6 before), all passing                     |
| db:types:check                                 | exit 0                                                                             |
| maestro:validate                               | exit 0 — **14 flows**, 4 helper scripts                                            |
| config:check (development)                     | exit 0                                                                             |
| expo export --platform all                     | exit 0 — **15 routes** (11 before)                                                 |
| bundle:inspect (development)                   | exit 0 — 20 text + 53 binary files                                                 |
| export:candidate / --qa-control                | exit 0 / exit 0 as a control (QA export correctly REJECTED)                        |
| secrets:scan                                   | **exit 3 (HOLD)** — exceptions proposed, not ratified                              |
| audit:gate                                     | **exit 3 (HOLD)** — waivers proposed, not ratified                                 |
| iOS/Android builds, devices, Maestro execution | **HOLD** — no device, simulator, or Maestro binary here                            |
| Supabase CLI stack (Docker)                    | **HOLD** — no Docker in this container; pgTAP ran on the local PostgreSQL fallback |

## Next

Device-lane evidence for both milestones on a machine with Docker and a
simulator, owner Kody. The run path is in README.md.
