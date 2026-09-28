# Work Order 004 — Milestone 3: Review and response

**Status: executed 2026-09-28 on Kody's desktop, under Kody's standing
instruction of 2026-09-18 ("just RUN … you know what I need, and you know
how to properly build it").** Every product decision this milestone
needed is recorded as provisional in `security/APPROVALS.md` for his
one-line ratification; none of them touches a HOLD item. How Honeybee is
told of a submission is a communication contract and stays HOLD for
Stacie. No production data, integration, signing, submission, or release
work was performed. Everything runs on synthetic `example.invalid`
identities and synthetic text.

**Owner:** Kody (acceptance, security, capability). **Wording:** Stacie.

## Provenance: a milestone built twice

Milestone 3 was first built on 2026-09-18 in a cloud session and
committed there as `624016d`, after Milestone 2 (`f0ae940`) and before
Milestone 4 (`58303a4`). None of the three commits reached GitHub, and
on 2026-09-28 the session's container was gone with them (see the
Milestone 2 work order for the full account). This execution rebuilds
Milestone 3 from the rebuilt Milestone 2 head on Kody's desktop. The code
is new; the decisions are restated below and in `security/APPROVALS.md`.

## 1. Outcome

On an open request, a client user can answer in words: write up to
4,000 characters, refer to any of the request's received documents,
keep the answer as a draft that lives with the request on the server
(visible from any device, never to staff), and submit it through one
explicit confirmation that says what submitting means. Submission moves
exactly one thing, the request, to "Answered"; the answer is then
immutable and readable by Honeybee staff at AAL2. A question can be
about a document, and the request names it, resolved inside the scope
even when the document sits on another request of the case.

Explicitly excluded: any accounting decision, review verdict, or
approval by anyone or anything (Milestone 4 is review and approval);
notifying Honeybee of a submission (HOLD, Stacie's contract); a client
or staff path that sets which document a request is about (seeded only);
editing or withdrawing a submitted answer; answering a closed or expired
request; anything on the device that outlives the screen.

## 2. Requirements

### Functional

- R1. A `request_answers` row per request (`unique (request_id)`),
  scoped exactly like `requests` and `document_uploads` (composite keys
  into the case and the request, indexed policy columns, permissive
  membership policy, restrictive staff-AAL2 policy), `SELECT`-only for
  clients. The lifecycle is `DRAFT -> SUBMITTED`; a trigger freezes
  identity columns from insert, refuses every change to a submitted
  answer, and bumps a version on every update.
- R2. `request_answer_citations`: the received documents an answer
  refers to, scope columns held to the answer's by trigger, insert and
  delete only while the answer is a draft, immutable once submitted, gone
  with the answer if the answer is removed with the table owner's
  authority (the synthetic lanes' reset).
- R3. Two reviewed server functions under the protected-mutation
  contract. `save_request_answer_draft` takes the exact scope, the
  request's version as the screen read it, the text, the cited document
  ids, and the draft's version (null for the first save); it verifies the
  caller's `client_user` membership in that scope, the request in that
  scope, OPEN, at that version, the text within 4,000 printable
  characters, at most 20 distinct citations, each a document received on
  that request, and the draft's version; it creates or updates the draft,
  replaces the citation set, and appends an audit receipt carrying the
  body's length and the citation count, never the text.
  `submit_request_answer` takes the answer id, its version, and an
  idempotency key the phone made once per confirmation; it verifies the
  caller wrote the answer and still holds the membership, the request is
  OPEN, the text is not blank, and every citation is still citable; it
  settles the answer with server time and the key, moves the request to
  ANSWERED, appends one enumerated activity entry (`request.answered`,
  actor `client_user`), and appends an audit receipt. The same key
  replays the same receipt; any other key after submission is refused.
- R4. Refusals are stable tokens the app words (`request_not_found`,
  `request_closed`, `request_changed`, `invalid_text`, `answer_too_long`,
  `too_many_citations`, `invalid_document`, `already_submitted`,
  `answer_changed`, `empty_answer`, `invalid_idempotency_key`); an
  authorization failure is `42501`, indistinguishable from a denied read.
  A request settled by this caller's own submission answers
  `already_submitted` ahead of `request_closed`.
- R5. Reads. Client users of the scope read the answer in every state;
  staff of the scope read a SUBMITTED answer at AAL2 and never a draft;
  citations follow the answer's visibility. `requests.subject_document_id`
  is a composite foreign key inside the request's own scope; the app
  resolves it by its own scoped read and renders nothing for a link it
  cannot resolve.
- R6. The app. The request detail names the document the request is
  about, shows a submitted answer (body, date, and the documents it
  refers to, named from the request's own documents), names a draft to
  its writer, and offers ONE primary action to a client user on an open
  request without a submitted answer: "Answer this request" or "Continue
  your answer"; "Add a document" stands beside it as the secondary
  control. Staff, a closed request, and a submitted answer get no
  control: absent, never disabled. The answer screen is a paragraph
  field with a live count, checkbox rows for the request's received
  documents (the state spoken and printed, never a glyph alone), "Save
  draft" when the draft differs from the server's copy, "Submit answer"
  leading to one confirmation ("Once submitted it cannot be changed, and
  Honeybee will see it. The request will show as answered.") with
  "Submit" and "Keep editing", and explicit saving, submitting,
  submitted, refused, and failed states. A refusal names why and what to
  do; a failure keeps the draft on screen with "Try again"; a stale or
  terminal refusal keeps the text on screen and offers only the way
  back.
- R7. The phone holds the typed text for the screen and one submission
  key per confirmation, kept through a transient failure so a retry can
  never submit twice, and dropped when the submission settles, is
  canceled, or the screen unmounts. A late result from a step the person
  moved past is dropped by epoch (P2-9). Control characters other than
  newline and tab are removed before any round trip; a blank or
  over-long submission is refused on the phone before any round trip and
  by the server regardless.

### Non-functional

- Every scope-bearing row carries non-null environment, client, and
  entity scope with composite foreign keys; every new table has RLS,
  least-privilege grants (`SELECT` to `authenticated`, nothing to
  `anon`), per-operation policies, indexed policy columns, and denial
  tests.
- The functions run `security definer` with `search_path = ''`, are
  executable by `authenticated` and `service_role` only, and re-derive
  the actor from `auth.uid()` on every call.
- Activity stays an enumerated vocabulary; the audit receipt records
  lengths and counts; no client-written text reaches the trail, a log, or
  a screen other than the request it belongs to.
- Wording is placeholder client language, Stacie's to replace wholesale
  (`ANSWER_REFUSAL_WORDING`, the answer view, the answer section of the
  request detail).

## 3. Threat deltas

| Threat                                                                  | Control                                                                                                                                                                                                                                 | Proof                                               |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| A client writes an answer row, a citation, or a request status directly | No client grant beyond SELECT; the only writes are the two functions, which verify scope, membership, status, versions, bounds, and citations; the request moves only inside `submit_request_answer`                                    | pgTAP 009; harness 3c                               |
| Staff, or a mixed-role user at AAL1, reads a draft or writes an answer  | Drafts readable through a `client_user` membership only; staff read SUBMITTED at AAL2 and nothing at AAL1; the functions refuse staff (42501); the control is absent from their screens                                                 | pgTAP 009 (52 to 57); harness 3c; `canAnswer` tests |
| Another client user of the same workspace takes over a draft            | A draft's `created_by` is checked on every save and on submission; the refusal is `answer_changed`, worded as "saved from another device or by someone else in your workspace"                                                          | pgTAP 009; `useAnswer` tests                        |
| A duplicate or replayed submission; a submitted answer edited           | One answer per request; the submission stores its key and replays the same receipt for it; any other key is refused; the lifecycle trigger refuses every update to a submitted answer and every change to its citations, for every role | pgTAP 009 (39, 48 to 50, 59, 60); harness 3c        |
| A stale screen overwrites a newer draft or answers a changed request    | The request's version and the draft's version travel with every write; a mismatch is a refusal, never an overwrite; the screen keeps the text and sends the person back to refresh                                                      | pgTAP 009 (22, 23, 34, 35); `answer-flow` tests     |
| A citation to a document outside the request, or one refused later      | Citations must be received on the same request (`citable_document_count`) and are re-checked at submission; a document that stopped being citable refuses the submission (`invalid_document`)                                           | pgTAP 009 (28, 38); harness 3c; live bridge         |
| Client-written text reaches the trail, a log, or an audit row           | The text lives on its protected row; activity stays enumerated; the receipt carries lengths and counts; the screens never echo a server message                                                                                         | pgTAP 009 (21, 46, 47); `AnswerView` tests          |
| A source link that reaches into another workspace                       | The composite foreign key makes it unrepresentable; the app resolves it by its own scoped read and renders nothing for a miss                                                                                                           | pgTAP 009 (8, 12 to 15); `loadRequestContext`       |
| A route param used as scope                                             | The request id is a filter inside the selected scope on every read and write; a foreign id yields "not found here" with no existence signal                                                                                             | contract tests; `screens-live`                      |

## 4. Acceptance tests

- **pgTAP suite 009** (62 assertions): structure and grants; the seeded
  source link resolved inside the scope; the draft path with every
  refusal; what submission moves and what it leaves alone; idempotency;
  the read matrix for the owner, another client, staff at AAL1 and AAL2,
  and a client who is also staff; immutability; the owner-authority
  removal the reset relies on. Suites 001 to 008 unchanged in intent
  (002 counts twelve granted tables; 007 and 008 count the new seeded
  question and its document).
- **jest**: `answers.test.ts` (the repository's scope filters, both
  writes, the refusal mapping, the receipt shape), `answer-rules`,
  `answer-flow` (every transition and refusal class), `useAnswer` (the
  draft, the versions, the local refusal, save-then-submit, one key
  through a failure, the server refusals), `answer-view` (every state,
  the checkbox rows, the confirmation, the forbidden words),
  `request-detail-view` (the source link, the primary action and the
  secondary control, the draft, the submitted answer for client and
  staff), `documents.test.ts` (the by-id read inside the scope), the
  scope contracts and the accessibility surface with the new props, and
  the `db-types` generator mapping array arguments.
- **Black-box harness step 3c**: the answer path with real JWTs over
  PostgREST (the source link; draft, refusals, blank draft saved but not
  submitted; submission, replay, second submission refused; the request
  moved and the case did not; the trail's enumerated entry; audit
  receipts unreadable; another client and AAL1 staff see nothing), and
  the two new tables in every AAL1 zero-row and AAL2 exact-reach proof,
  with the rows this run created counted exactly.
- **Live bridge** (`tests/live/answers-live.test.ts`): the shipped
  composition against the real stack: the question with its source
  document resolved by the repositories, the draft saved and read back
  with its citation, the three typed refusals, the submission, the
  replay, the request answered, the trail entry.
- **Maestro** `request-respond.yaml`: on glass, the source link named,
  the one primary action, the draft saved with "Nothing has been
  submitted", the cited document row saying so in words, the
  confirmation's wording, and the request answered with the answer on
  it and no control.
- **Tooling**: `local-supabase.mjs reset-answer <requestKey>` (checked,
  loopback-only, seeded keys only, readback-verified) so the flows, the
  harness, and the bridge can run again on the same stack; the harness
  and the CLI-stack bridge call it themselves.

## 5. Decisions made under the standing instruction (provisional)

Recorded in `security/APPROVALS.md` under "Milestone 3": the 4,000
character bound; the citation rule (up to 20, received on the same
request, re-checked at submission); one answer per request and no
takeover of a draft; the draft on the server, never on the device, never
to staff; what a submission moves and what it never moves; who reads a
submitted answer; a blank draft saved but never submitted; the answer as
the primary action beside the document control; the source link seeded
only; notifying Honeybee as HOLD; placeholder wording. Each is reversible
by changing one value and re-running the gates.

## 6. Dependencies and rollout controls

- C1. No client write reaches a table: every write is a reviewed function
  that decides who may act, and the functions are the only grant.
- C2. Nothing in this milestone decides, approves, files, or notifies.
  An answer is a HIVE record.
- C3. Controls are absent, never disabled, for anyone the server would
  refuse.
- C4. The reset is loopback-only, keyed to seeded requests, and runs with
  a bearer that lives in memory for the duration of one command.
- D1. Communication contract (Stacie): how Honeybee learns of a
  submission. HOLD; nothing here notifies anyone.
- D2. Record contract (Kody): whether a submitted answer is ever exported
  or filed. Not addressed; Google Drive remains the permanent record and
  filing manual.

## 7. Execution record

See "Milestone 3 execution record" below, written as the lanes ran.

## Milestone 3 execution record — 2026-09-28, Kody's desktop

From the Milestone 2 head `b051c4c` (pushed by Kody the same day), on the
same desktop, the same Docker stack, and the same emulator.

### Checkpoint 1 — the schema, the transitions, the proofs

- `supabase/migrations/20260928120009_milestone3_review_and_response.sql`:
  the source link on `requests` (composite foreign key inside the
  request's scope, indexed), `request_answers` and
  `request_answer_citations` with the Milestone 0 policy shape and the
  draft-to-clients-only rule inside the permissive policy, the lifecycle
  and citation-guard triggers, `save_request_answer_draft` and
  `submit_request_answer` with every refusal token, the audit receipts
  carrying lengths and counts, and the function privileges (nothing
  callable by default; `authenticated` and `service_role` only).
- The seed gained the November question (A1, OPEN, about the checked
  November statement on the answered request), one checked document of
  its own, and the source link applied by both seed lanes after the
  documents exist (`scripts/lib/synthetic-documents.mjs`,
  `scripts/seed-local.mjs`, the rendered SQL mirror).
- pgTAP suite 009, 62 assertions; suites 002, 007, and 008 updated for the
  new tables and rows.
- `scripts/db-types.mjs` maps array arguments; the committed types match
  the schema.

### Checkpoint 2 — the app

- `src/data/supabase/answers.ts`: the answer repository (the scoped read
  with its citations, both writes, the refusal mapping, the receipt
  shape). `documents.ts` gained the by-id read inside the scope;
  `repositories.ts` carries the source link on a request.
- `src/features/answers/`: the rules, the flow reducer, the hook (one
  submission key per confirmation, kept through a failure), the view
  (every state explicit; the citation checkbox rows spoken and printed),
  and the connected screen; `app/requests/[id]/respond.tsx` the route.
- The request detail names the source document, shows a submitted answer
  or a draft, and offers the answer as the one primary action with the
  document control beside it; `TextField` gained a multi-line mode; the
  shared labels carry the answer wording; the composition root and the
  live composition wire the repository and the device random source.
- Tests: 52 jest suites, 646 tests, among them the new `answers`,
  `answer-rules`, `answer-flow`, `useAnswer`, and `answer-view` suites and
  the extended `request-detail-view`, `documents`, scope-contract, and
  accessibility suites.

### Checkpoint 3 — the tooling, the black-box proofs, the records

- `scripts/lib/answer-reset.mjs` and `scripts/answer-reset.mjs`
  (`local-supabase.mjs reset-answer <requestKey>`): the checked,
  loopback-only, readback-verified reset of a seeded question, unit
  tested; the harness and the CLI-stack bridge call it themselves.
- `scripts/lib/answer-path.mjs`, harness step 3c: the answer path with
  real JWTs, and the two new tables in every AAL1 zero-row and AAL2
  exact-reach proof.
- `tests/live/answers-live.test.ts`: the shipped composition's journey.
- `.maestro/request-respond.yaml`, validated (20 flows).
- `security/APPROVALS.md` (the Milestone 3 provisional decisions),
  `PRODUCT.md` (the answer lifecycle), `SECURITY.md` (the threats and the
  controls), `.maestro/README.md`, and this record.

### Finds this execution produced

Recorded with their fixes in
`security/evidence/2026-09-28-desktop-m3/README.md`: find 60 (the
harness and GoTrue's one-second send floor), find 61 (the citation guard
and the cascade the reset needs), the harness's citation-row bookkeeping,
`already_submitted` ahead of `request_closed`, array arguments in the
generated types, testing-library 14's asynchronous events, the surviving
Metro that kept serving the old bundle, Gboard's one-time stylus sheet on
the emulator, and whole-text Maestro selectors.

### Gates at the candidate, all fresh

| Gate                                                    | Result                                                                       |
| ------------------------------------------------------- | ---------------------------------------------------------------------------- |
| typecheck                                               | exit 0                                                                       |
| eslint, max-warnings 0                                  | exit 0                                                                       |
| prettier, check                                         | exit 0                                                                       |
| verify:toolchain                                        | OK                                                                           |
| jest                                                    | **646 passed across 52 suites**                                              |
| test:scripts (node:test)                                | **359 passed, 0 failed, 36 skipped** (device-lane tests)                     |
| pgTAP, CLI stack (`supabase test db`)                   | **9 files, 266 asserts, PASS** (suite 009: 62)                               |
| black-box harness, CLI stack (`local-supabase.mjs e2e`) | **215 passed, 0 failed** on a fresh seed                                     |
| live bridge, CLI stack (`local-supabase.mjs bridge`)    | **9 passed across 4 suites** (the answer journey among them)                 |
| maestro:validate                                        | OK — 20 flows, 5 helper scripts                                              |
| db:types:check                                          | committed types match the schema                                             |
| config:check                                            | OK for profile development                                                   |
| eas:guard                                               | OK                                                                           |
| audit:gate                                              | OK — one moderate (`uuid`) below the gate, no waiver on file                 |
| secrets:scan, with Kody's ratification record           | OK — 382 tracked files, 1039 history blobs, 4 exceptions reconciled          |
| export:candidate (inspects its own output)              | OK — 22 text and 65 binary files, zero QA-hook markers                       |
| Maestro on `Pixel_8`                                    | `sign-in.yaml` exit 0; `request-respond.yaml` exit 0 (evidence folder above) |

### State

Milestone 3 built, gated, and run on the device on this desktop; the
provisional decisions are listed in `security/APPROVALS.md` for one line
from Kody, and how Honeybee is told of a submission stays HOLD for
Stacie. Committed on `claude/hive-fable-5-greenfield-p0cwkq`.

Next: Milestone 4, internal review and approval, on the same standing
instruction, from this candidate.
