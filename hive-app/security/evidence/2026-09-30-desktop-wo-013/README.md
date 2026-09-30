# WO-013 — intake — 2026-09-30

Executed on Kody's Windows desktop from a local Claude session, at the
tree committed with this record, under his standing instruction and his
"move forward" of the day. Emulator `Pixel_8` (API 35), Docker stack
(Supabase CLI 2.115.0), Maestro 2.10.0, Node 22.23.2, the Milestone 2
QA build reused unchanged (nothing native changed), Metro started with
the QA hooks and the local origin (the served bundle was read before
any launch: the intake screens present, the loopback origin, the local
publishable key, no secret key shape). Staging received migration 016;
production received migrations 015 and 016 and holds no rows. The
database passwords came from Kody's approvals folder into a process
environment and appear in no log; the runner's logs print the flow
variables' names, never a code. Frames were captured from the host only
after the login flow began; nothing here shows the enrollment screen.

| Step | Command                                                                                                                                     | Result                                                                                                                                                  |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `supabase db reset`, `local-supabase.mjs seed`, `supabase test db`                                                                          | ✅ migration `20260930120016` applied; **16 files, 605 assertions, PASS** (54 new in suite 016) — `pgtap-local.log`                                      |
| 2    | `local-supabase.mjs e2e` (the black-box harness, new step 4e)                                                                               | ✅ **511 checks, 0 failed**; the intake path's 62 lines in `harness-local.log`                                                                            |
| 3    | `maestro:enroll -- --as intake.beth@example.invalid --scope "Harbor Light Bakery LLC (Synthetic), Harbor Light Holdings LLC (Synthetic), Intake" --then case-intake.yaml` | ✅ enroll → sign-out → login on the same factor, each taking the workspace chooser on the runner's word → the intake flow → revoke: `maestro:enroll OK` — `device-lane.log`, captures `01`–`09` |
| 4    | `db push` by connection string to staging, then `supabase test db` there                                                                    | ✅ the one pending migration applied — `db-push-staging.log`; 16 files, 605 assertions, PASS — `pgtap-staging.log`                                       |
| 5    | `db push` by connection string to production (015 and 016, as WO-012 recorded), then a read as the database owner                            | ✅ both applied — `db-push-production.log`; 0 users, 0 rows, the five intake functions granted to `authenticated` only, the four onboarding functions to the server role only — `production-state.log` |
| 6    | `db:types:check` against the local stack and against production                                                                             | ✅ the committed types match both                                                                                                                        |
| 7    | jest, the script tests, lint, format, typecheck, validate, privacy, audit, secrets, release config, toolchain, export                          | ✅ 67 suites / 779 tests; 478 script tests (442 passed, 36 skipped by platform); every gate exit 0                                                       |

## What the desktop proved that no build container could

- **The whole intake path on glass, as intake.** Home offered one way
  to open a case (`02`); the title was confirmed with what the client
  will see (`03`); the case opened as a draft with nothing asked of the
  client (`04`); recording the intake went through its confirmation
  (`05`) and the case showed as received; the request was asked on its
  own screen with a due date and no subject (`06`, `07`); the first
  request moved the case to waiting on documents; the request showed as
  needing a response, was closed through a confirmation, and showed as
  closed with the case unmoved (`08`); Home listed the case in its new
  state with derived guidance (`09`).
- **A staff identity with four memberships through the enrollment
  sequence.** The chooser (`01`) was taken by a conditional block in the
  three shared flows, with the row named by a selector that carries no
  backslash; the runner reset and revoked intake.beth's factor around
  the run.

## Finds, all fixed in this run

- **Find 76.** A Notice prints its tone before its title; the flow
  asserts `Done: Case opened`, `Done: Request opened`, `Note: Record the
  intake?`, `Note: Close this request?`.
- **Find 77.** The close confirmation renders at the foot of the case,
  below the fold from the request's row: the flow scrolls to it.
- **Find 78.** One login of four did not reach the second-factor screen
  after GoTrue accepted the email code (nothing followed in the auth
  log; the crash buffer was empty; the runner's cleanup ran); the re-run
  passed. The lane's known transient.

## Observed, outside this work order

- Staging holds one AAL1 session row for a `myhbcfo.com` identity from
  the 2026-09-29 device rehearsal against staging; staff read nothing at
  AAL1, and the row expires on its own.
- Every device run adds one case to the seeded Harbor Light Holdings
  workspace; `db reset` and `seed` return it to empty (done between the
  runs recorded here).
