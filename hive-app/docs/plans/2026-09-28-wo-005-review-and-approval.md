# Work Order 005 — Milestone 4: Internal review and approval

**Status: executed 2026-09-28 on Kody's desktop, under Kody's standing
instruction of 2026-09-18 ("just RUN"), started on his word the same day
("I ratify the Milestone 2 and 3 decisions, start Milestone 4").** Every
product decision this milestone needed is recorded as provisional in
`security/APPROVALS.md` for his one-line ratification; none of them
touches a HOLD item. No production data, integration, signing,
submission, or release work was performed. Everything runs on synthetic
`example.invalid` identities and synthetic evidence.

**Owner:** Kody (acceptance, security, capability). **Wording:** Stacie.

## Provenance

Milestone 4 was first built on 2026-09-18 in a cloud session and
committed there as `58303a4`, never pushed, and lost with the session's
container (see the Milestone 2 work order). Its transcript was no longer
reachable when this rebuild began, so this execution restates the
milestone from the brief, PRODUCT.md's roadmap row and case lifecycle,
and the repository as it stood at the Milestone 3 candidate (`6234f12`).

## 1. Outcome

A case's evidence can be frozen into a review package by its preparer,
reviewed read-only by a conflict-free reviewer who records exactly one
of PASS, RETURN, or HOLD, and approved by a conflict-free approver whose
approval is bound to the exact package (id and digest), the case version,
the actor, the role, the scope, a destination, and an expiry. Material
change supersedes an approval; time expires it. Staff see the package,
the verdicts, and the approvals at AAL2 and act through one confirmed
action per role and status; clients see the case status and the
enumerated trail. An approval is a HIVE workflow record: not a release,
a reconciliation, a completion, or a filing.

Explicitly excluded: intake's own steps (`DRAFT`, `INTAKE_RECORDED`),
authoring attention items and next actions (a communication contract),
any external destination for an approval (Drive filing is Milestone 5,
with its own approval), editing evidence during review, notifying anyone.

## 2. Requirements

### Functional

- R1. `cases` carries an object version; every transition names the
  version the screen read and is refused (`case_changed`) on a stale one.
- R2. `case_review_packages`: one row per freeze, numbered per case, the
  manifest (every request with status and version; every submitted answer
  as id, version, and text digest; every checked document as id, digest,
  and size; ids and digests only) and its SHA-256, the case version, the
  freezer and role, immutable once frozen except for being superseded by
  the next package; at most one current package per case.
- R3. `case_reviews`: one verdict per role per package; a reviewer's is
  started (`IN_REVIEW`) then recorded; an approver's RETURN or HOLD on a
  passed package is recorded in one step; a bounded printable note on
  the staff-only row; a recorded verdict is immutable.
- R4. `case_approvals`: the binding as columns, immutable from insert;
  status `ACTIVE` ends only by expiry or supersession, with the reason;
  one active approval per package; destination `hive-record` only;
  expiry set by the server (30 days).
- R5. Five reviewed transitions under the protected-mutation contract,
  `security definer`, re-deriving the actor, requiring AAL2 and the exact
  role membership in the exact scope, locking the case, checking status,
  version, and conflicts, moving exactly what the step moves, appending
  one enumerated trail entry and one audit receipt whose details carry
  the key and the result (so a repeated key replays the same result):
  `freeze_case_package` (preparer; from `EVIDENCE_PENDING` or `APPROVED`,
  superseding the current package and any active approval),
  `start_case_review` (reviewer, not the freezer),
  `record_case_verdict` (the reviewer who started it, or an approver who
  is neither freezer nor reviewer, RETURN or HOLD only), `resume_case`
  (preparer from `RETURNED` and `APPROVED`, approver from `HOLD`), and
  `approve_case_package` (approver, neither freezer nor reviewer, the
  current package by id and digest, `hive-record`, after a recorded
  PASS). A server-role sweep, `expire_case_approvals`, ends expired
  approvals and returns a case still standing on one to
  `APPROVAL_PENDING`.
- R6. Refusals are stable tokens the app words; authorization failures
  are `42501`, indistinguishable from a denied read.
- R7. Reads: the three tables grant `SELECT` to `authenticated` under a
  permissive policy admitting staff of the row's own scope and the
  restrictive staff-AAL2 layer; no client role reads them.
- R8. The app: a staff Home row opens the case review (clients' rows stay
  read-only); the review screen shows the case, the package (number,
  freeze date and role, full digest, the frozen requests by title, the
  answers and documents by digest and size), the verdicts with notes,
  the approvals with their binding and expiry, and the viewer's actions
  for their role and the case status, each through a confirmation that
  says what it means; a refusal names why, a stale screen is sent to
  refresh; a client reaching the route sees a staff-only notice.
- R9. The phone holds one transition key per confirmation, kept through
  a transient failure so a retry cannot move the case twice; a late
  result is dropped by epoch; a settled transition reloads the case and
  starts a fresh flow on the new version.

### Non-functional

- Composite foreign keys into the case and, for verdicts and approvals,
  into the package, all inside one scope; indexed policy columns; denial
  tests for every role and AAL.
- Nothing authored here reaches a client screen except the case status
  and the eight enumerated trail kinds, worded in the app.
- Lane tooling acts without borrowed authority: staging signs staff in
  for real and calls the transitions; the reset is loopback-only and
  keyed to seeded cases.

## 3. Threat deltas

| Threat                                                             | Control                                                                                                                       | Proof                                                          |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| A client, intake, or AAL1 staff moves a case or reads the workflow | Staff-only policies at AAL2; the functions require the exact role in the exact scope; everything else is 42501                | pgTAP 010 (17 to 19, 35 to 42, 49, 57, 63, 81, 90); harness 4b |
| The freezer reviews, or the freezer or reviewer approves           | Compared on the server against the package and its verdict rows; `conflict_of_interest`                                       | pgTAP 010 (43, 64)                                             |
| A verdict or approval on stale state                               | The case version travels with every write; the approval names the current package's id and digest                             | pgTAP 010 (20, 44, 65, 66, 68); live bridge                    |
| An approval without exact scope, digest, destination, or expiry    | Every binding element is a column, immutable from insert; `hive-record` is the only destination; the server sets the expiry   | pgTAP 010 (67, 70 to 72, 85)                                   |
| A stale approval that still authorizes                             | A new package or a reopened case supersedes it; the sweep expires it and the case asks again                                  | pgTAP 010 (60, 78, 86 to 89)                                   |
| A lost response moves the case twice                               | The audit receipt is the record of the mutation; the same actor's same key replays the same result                            | pgTAP 010 (30, 46, 73); harness 4b; `useCaseReview` tests      |
| A frozen package, a verdict, or an approval edited                 | Triggers refuse it for every role including the owner                                                                         | pgTAP 010 (83 to 85)                                           |
| A note or a name reaches the trail, an audit row, or a client      | The manifest holds ids and digests; the note lives on the staff-only row; audit details carry lengths; activity is enumerated | pgTAP 010 (29, 56); `CaseReviewView` tests                     |
| A route param used as scope                                        | The case id is a filter inside the selected scope; a foreign id is "not found here"                                           | `ReviewRepository` tests; harness 4b (`other`)                 |

## 4. Acceptance tests

- **pgTAP suite 010** (90 assertions): structure and grants; freezing by
  role, AAL, and version; the manifest's contents and its reproducible
  digest; the read matrix; review with conflicts, versions, and every
  refusal; resume, a second package, PASS, and approval with its four
  refusals, its binding, its replay, and its expiry; reopening; an
  approver's HOLD and its lifting; immutability; the sweep; the client's
  zero rows. Suite 002 names fifteen granted tables.
- **jest**: `reviews.test.ts` (reads, writes, tokens, the manifest
  decoder), `review-rules`, `review-flow`, `useCaseReview` (the key, the
  binding, local refusals), `case-review-view` (every state, the staff-only
  notice, the confirmations' wording), the Home view with its optional
  staff tap-through, and every earlier suite unchanged.
- **Black-box harness step 4b**: the whole path with real AAL2 JWTs for
  preparer.pat, reviewer.rae, and approver.avery, and the three tables in
  every AAL1 zero-row and AAL2 exact-reach proof, per identity.
- **Live bridge** (`tests/live/review-live.test.ts`): three staff journeys
  through the shipped composition, each through OTP and TOTP enrollment.
- **Maestro** `case-review.yaml`, run by the enrollment runner's `--then`
  step on the AAL2 session it just proved: a staff Home row opens the
  case; the package and its digest on glass; start review through its
  confirmation; PASS with a note through its confirmation; the case
  awaiting approval with the verdict on record and nothing left to do.
- **Tooling**: `reset-case a1` and `stage-case a1 <state>`, unit tested
  where they have logic; the CLI-stack bridge resets three factors and
  the case before its suites.

## 5. Decisions made under the standing instruction (provisional)

Recorded in `security/APPROVALS.md` under "Milestone 4": who freezes;
what a package holds; the conflict rules; the verdicts each role may
record; the note bound; what each transition moves and what it never
moves; who resumes; the approval's binding; `hive-record` as the only
destination; the 30-day expiry and the sweep; who reads the workflow; the
staff surface in the same binary; the lane tooling; the wording.

## 6. Dependencies and rollout controls

- C1. No client write reaches a workflow table; the functions are the
  only grant, and they decide who may act.
- C2. Nothing in this milestone releases, reconciles, completes, or files
  anything; an approval names the HIVE record alone.
- C3. Controls are absent, never disabled, for anyone the server would
  refuse; a conflict the screen cannot know about is worded when the
  server refuses it.
- C4. The reset is loopback-only and keyed to seeded cases; staging acts
  through real staff sessions.
- D1. Approval Matrix and Playbook (Kody): whether the conflict rule and
  the 30-day expiry match the written policy; both are one value each.
- D2. Communication contract (Stacie): how a returned case, a hold, or an
  approval is told to the client beyond the trail; nothing here notifies.
- D3. Intake's steps and the authoring of attention items and next
  actions: later milestones.

## 7. Execution record

See "Milestone 4 execution record" below, written as the lanes ran.

## Milestone 4 execution record — 2026-09-28, Kody's desktop

From the Milestone 3 head `6234f12` and the ratification record
`d5c2483`, on the same desktop, the same Docker stack, and the same
emulator, started on Kody's word the same day.

### Checkpoint 1 — the schema, the transitions, the proofs

- `supabase/migrations/20260928120010_milestone4_review_and_approval.sql`:
  the case version and its bump; the eight workflow kinds in the activity
  vocabulary; `case_review_packages`, `case_reviews`, and
  `case_approvals` with their constraints, immutability triggers, grants,
  and policies (staff of the row's scope, at AAL2); the helpers (the
  acting staff member, the manifest and its digest, the replay, the
  locked case, the trail entry); the five transitions; the server-role
  expiry sweep; the function privileges.
- pgTAP suite 010, 90 assertions; suite 002 names fifteen granted tables.
- The committed database types regenerated and checked.

### Checkpoint 2 — the app

- `src/data/supabase/reviews.ts`: the review repository (the case, the
  current package with its manifest decoded, the verdicts, the approvals,
  the five writes, the refusal mapping).
- `src/features/review/`: the rules (which action a role may take on
  which status, which verdicts, the note bound, the one destination), the
  flow reducer, the hook (one key per confirmation, kept through a
  failure), the view (the package with its full digest and contents, the
  verdicts with notes, the approvals with their binding and expiry, the
  role's actions through confirmations, a staff-only notice for clients),
  the connected screen keyed on the case version; `app/cases/[id].tsx`
  the route; a staff Home row opens the case.
- `src/core/text.ts` shared by the answer and the note; the shared labels
  carry the workflow's wording; the compositions wire the repository.
- Tests: 57 jest suites, 687 tests, among them the new `reviews`,
  `review-rules`, `review-flow`, `useCaseReview`, and `case-review-view`
  suites and the Home view's optional staff tap-through.

### Checkpoint 3 — the tooling, the black-box proofs, the records

- `scripts/lib/staff-session.mjs` (a synthetic staff identity to AAL2
  through OTP and TOTP, loopback only), `scripts/lib/case-reset.mjs` and
  `scripts/case-reset.mjs` (`reset-case <caseKey>`, unit tested),
  `scripts/case-stage.mjs` (`stage-case <caseKey> <state>`),
  `scripts/lib/review-path.mjs` (harness step 4b), the harness's
  per-identity reach, the CLI-stack bridge's extra resets, the enrollment
  runner's `--then <flow>` (unit tested).
- `tests/live/review-live.test.ts`: three staff journeys through the
  shipped composition.
- `.maestro/case-review.yaml`, validated (21 flows).
- `security/APPROVALS.md` (the Milestone 4 provisional decisions),
  `PRODUCT.md` (the case lifecycle as implemented), `SECURITY.md` (the
  threats and the controls), the README's desktop runbook, the Maestro
  README, and this record.

### Finds this execution produced

Recorded with their fixes in
`security/evidence/2026-09-28-desktop-m4/README.md`: the Home route's
opener left out by a failed multi-edit (the row was not pressable on the
device), the flow's viewport-only last step, and, in the harness, a trail
read that also caught the seeded status-change event. Server-side, the
citation guard, the shell layer's `$$`, and testing-library 14's
asynchronous events were already known from Milestone 3.

### Gates at the candidate, all fresh

| Gate                                                    | Result                                                                 |
| ------------------------------------------------------- | ---------------------------------------------------------------------- |
| typecheck                                               | exit 0                                                                 |
| eslint, max-warnings 0                                  | exit 0                                                                 |
| prettier, check                                         | exit 0                                                                 |
| verify:toolchain                                        | OK                                                                     |
| jest                                                    | **687 passed across 57 suites**                                        |
| test:scripts (node:test)                                | **364 passed, 0 failed, 36 skipped** (device-lane tests)               |
| pgTAP, CLI stack (`supabase test db`)                   | **10 files, 356 asserts, PASS** (suite 010: 90)                        |
| black-box harness, CLI stack (`local-supabase.mjs e2e`) | **288 passed, 0 failed** on a fresh seed                               |
| live bridge, CLI stack (`local-supabase.mjs bridge`)    | **10 passed across 5 suites** (the review journeys among them)         |
| maestro:validate                                        | OK — 21 flows, 5 helper scripts                                        |
| db:types:check                                          | committed types match the schema                                       |
| config:check                                            | OK for profile development                                             |
| eas:guard                                               | OK                                                                     |
| audit:gate                                              | OK — one moderate (`uuid`) below the gate, no waiver on file           |
| secrets:scan, with Kody's ratification record           | OK                                                                     |
| export:candidate (inspects its own output)              | OK — 23 text and 65 binary files, zero QA-hook markers                 |
| Maestro on `Pixel_8`                                    | `maestro:enroll -- --then case-review.yaml` OK (evidence folder above) |

### State

Milestone 4 built, gated, and run on the device on this desktop; the
provisional decisions are listed in `security/APPROVALS.md` for one line
from Kody; the Approval Matrix's own conflict and expiry values (Kody)
and the client-facing communication of a return, a hold, or an approval
(Stacie) stay open. Committed on `claude/hive-fable-5-greenfield-p0cwkq`.

Next: Milestone 5, source adapters (QuickBooks Online read-only references
and verified manual Drive filing receipts), which needs the adapter
contracts and stays HOLD on live integrations until Kody names them.
