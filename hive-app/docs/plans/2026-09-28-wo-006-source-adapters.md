# Work Order 006 — Milestone 5: Source adapters

**Status: executed 2026-09-28 on Kody's desktop, under Kody's standing
instruction of 2026-09-18 ("just RUN"), started on his word the same day
("I ratify the Milestone 4 decisions, start Milestone 5").** Every
product decision this milestone needed is recorded as provisional in
`security/APPROVALS.md` for his one-line ratification; none of them
touches a HOLD item. No live ledger and no live Drive was read or
written: both adapters are NAMED synthetic stand-ins, production-inert,
and the live QuickBooks Online and Google Drive adapters stay HOLD until
their own adapter PASS. Everything runs on synthetic `example.invalid`
identities and synthetic evidence.

**Owner:** Kody (acceptance, security, capability, the adapter PASS).
**Wording:** Stacie.

## 1. Outcome

A case can refer to ledger objects and can be filed to the permanent
record, without HIVE becoming either. A **ledger reference** is what a
read-only adapter saw: the object's type, identifier, version, own
label, as-of time, and a digest over what it read; never a value. Only
the server role records one, through a named adapter, and it is
immutable. A **filing receipt** says that a person filed a checked,
approved document to Drive by hand: the document, the Drive file id,
the folder path, recorded by intake or the preparer at AAL2 on an
approved case, claiming the document's checked digest and bound to the
approved package. The named record adapter then checks, read-only,
whether the Drive object holds exactly those bytes, and the receipt
settles once as VERIFIED or MISMATCH. A filing moves nothing on the
case. Staff read the sources and the record on the case review; clients
see the enumerated trail.

Explicitly excluded: any write to QuickBooks Online; any automatic
Drive mutation (create, move, rename, delete, share); a live adapter of
either kind; reading a ledger value into HIVE; filing a document the
approval does not cover; notifying anyone.

## 2. Requirements

### Functional

- R1. `ledger_references`: scope-bound, case-bound rows with source
  (`qbo`), realm, object type (Account, JournalEntry, Invoice, Bill,
  Payment, Report), object id, object version, a bounded printable
  label, as-of, a SHA-256 digest, and the adapter's name; unique per
  (case, source, realm, type, id, version); immutable.
- R2. `record_ledger_reference`: server role only; refuses an unknown
  case and a bad label; replays the same id for the same object at the
  same version; appends `source.referenced` to the trail and one audit
  receipt (ids, never the label).
- R3. `filing_receipts`: scope-bound rows naming the document, the
  approved package, the Drive file id (one shape), the folder path
  (bounded, printable), the claimed digest, who filed and in which role,
  status `RECORDED -> VERIFIED | MISMATCH`, what was found, the adapter's
  name, the idempotency key; unique per (document, Drive file).
- R4. `record_filing_receipt`: the Milestone 4 transition contract
  (exact scope, case version, key, AAL2 intake or preparer membership,
  atomic audit receipt); requires an APPROVED case on an ACTIVE approval
  and a checked document inside the approved package's manifest; refuses
  `case_not_approved`, `document_not_filable`, `document_not_approved`,
  `invalid_file_id`, `invalid_path`, `receipt_exists`, `case_changed`;
  replays by key; moves nothing on the case.
- R5. `verify_filing_receipt`: server role only; settles a RECORDED
  receipt once as VERIFIED when the found digest equals the claim, else
  MISMATCH (a missing object included); keeps the found digest and the
  adapter's name; a settled receipt is returned as it stands; appends
  `record.verified` or `record.mismatch` and one audit receipt.
- R6. Reads: staff of the row's scope at AAL2 read both tables; clients
  read zero rows; the app's loader lists references and receipts by case
  and the case's documents by case (to name them).
- R7. The case review shows Sources (label, type, version, as-of,
  digest, adapter) and Permanent record (document name, status, path and
  file id, who filed and when, the check and what it found); intake and
  the preparer get the filing form on an approved case, through one
  confirmation that says HIVE writes nothing to Drive; every refusal is
  worded; a stale one is sent to refresh.
- R8. Adapter contracts, documented in the synthetic adapters: the
  ledger's `fetchLedgerObject` and `listObjectsFor`; the record's
  `checkFile`; neither has a write.

### Non-functional

- N1. Synthetic data only; "(Synthetic)" labels; no value of any kind in
  a reference; no path, label, or content digest in audit details, the
  trail, logs, or the tooling's output.
- N2. Loopback-only tooling with the bearer in memory; the adapters are
  named on every row they touch.
- N3. The gates of the previous milestones, all fresh, plus pgTAP 011,
  harness step 4c, the live bridge's intake continuation, and one device
  flow.

## 3. Threat deltas

- T-M5-1 **A value leaks into HIVE through a "reference".** The shape has
  no column for one; the label is bounded and printable; the digest
  covers fixture text; the synthetic adapters have no numeric field.
- T-M5-2 **The app or a client records a reference or verifies a
  receipt.** Both functions are the server role's alone (grant and
  `require_server_role`); proven with real JWTs in the harness and in
  pgTAP.
- T-M5-3 **A receipt files what the approval never covered.** The
  document must be in the approved package's manifest; a document
  checked after the freeze is refused (`document_not_approved`, pgTAP
  011 with a post-freeze document).
- T-M5-4 **A receipt is trusted without a check.** It reads RECORDED until
  the adapter settles it; a missing object is a MISMATCH.
- T-M5-5 **HIVE mutates the record.** No code path writes to Drive; the
  contract has no write; the tooling's requests are reads and the
  server-role verification rpc only (unit test).
- T-M5-6 **A filing moves the case or spends the approval.** The
  transition changes no case column; the harness checks the version and
  status after filing.

## 4. Acceptance tests

- pgTAP `011_milestone5_source_adapters.test.sql` (53): structure and
  grants; references (record, replay, immutability, reads by role);
  receipts (every refusal, the binding to the approved package, the
  post-freeze document, replay, duplicate); verification (VERIFIED,
  MISMATCH, settled once).
- jest: `reviews.test` (reads and the filing write), `documents.test`
  (`listByCase`), `review-rules` (actions, `checkFiling`,
  `filableDocuments`), `review-flow` (the filing draft), `useCaseReview`
  (the filing transition), `case-review-view` (the two sections, the
  form, the confirmation, the refusals).
- node:test `synthetic-adapters.test.mjs`: both adapters named and
  read-only; the record's digests restate the seeded documents; the sync
  and verification libraries against a fake gateway.
- Harness step 4c (`scripts/lib/source-path.mjs`): the interface refused
  to a client and to staff; sync and replay; reads by role; every
  filing refusal; the receipt, its replay, the duplicate; both
  verifications; the case unmoved; the trail; exact reach with both
  tables.
- Live bridge: intake.beth reads the synced references and records a
  receipt through the shipped composition.
- Maestro `case-sources.yaml`: reviewer.rae reads Sources and Permanent
  record on the approved case.

## 5. Decisions made under the standing instruction (provisional)

Recorded in `security/APPROVALS.md` under "Milestone 5": a reference is
never a value; who records one; the object types; immutability; who reads;
filing is by hand; who records a receipt and on what; the receipt
lifecycle; that a filing moves nothing; the bounds; the staff surface;
the lane tooling; the wording.

## 6. Dependencies and rollout controls

- C1. No live adapter exists in the repository; the synthetic ones are
  named on every row and are the only implementations of the contracts.
- C2. The adapter interface is the server role's; the app cannot reach
  it; the service key never ships in the app.
- C3. A live QuickBooks Online adapter needs its own PASS: credentials,
  realm binding, the object types and versions it may read, and the
  read-only proof; HOLD.
- C4. A live Drive adapter needs its own PASS: which folder a filing may
  name, the file-id shape as Drive issues it, and the read-only proof;
  HOLD. Nothing here ever writes to Drive.
- D1. Recordkeeping Bible (Kody): whether the filing convention (folder
  path per case) and the "verified by digest" rule match the written
  policy.
- D2. Communication contract (Stacie): whether a client is ever told a
  document was filed beyond the trail; nothing here notifies.

## 7. Execution record

See "Milestone 5 execution record" below, written as the lanes ran.

## Milestone 5 execution record — 2026-09-28, Kody's desktop

Rebuilt in the same local session as Milestones 2 to 4, from the
Milestone 4 candidate (`eb1a974`) and its ratification record
(`bdd86a0`), on the same Docker stack (Supabase CLI 2.115.0), emulator
`Pixel_8` (API 35), Maestro 2.10.0, Node 22.23.2, the Milestone 2 QA
build reused unchanged (no native module was added), Metro restarted for
the new bundle and the served bundle checked for the new section ids
before the device run.

### Checkpoint 1 — the schema, the adapter interface, the proofs

Migration `20260928120011_milestone5_source_adapters.sql`: the four
trail kinds; `ledger_references` (immutable, unique per object version,
staff-of-scope reads under the restrictive AAL2 layer);
`filing_receipts` (the receipt's binding as columns, a one-way
lifecycle, the same reads); `record_ledger_reference` and
`verify_filing_receipt` for the server role alone;
`record_filing_receipt` under the Milestone 4 transition contract. pgTAP
`011` (54) proves structure and grants, the references, every filing
refusal including a document checked after the freeze, the binding to
the approved package, replay, and both verification outcomes; `002`
holds the grants of seventeen tables.

### Checkpoint 2 — the adapters and the app

`HiveSyntheticLedger` and `HiveSyntheticDrive`, named, read-only by
construction, with the contracts a live adapter must meet written at
their head; the record adapter's digests restate the seeded documents
so a drifted seed fails there. The app's review repository lists
references and receipts and records a filing; the documents repository
lists a case's documents; the case review gains Sources and Permanent
record, the filing form for intake and the preparer on an approved
case, the confirmation that says HIVE writes nothing to Drive, and the
wording for six new refusals; the activity trail knows the four kinds.

### Checkpoint 3 — the tooling, the black-box proofs, the records

`sync-ledger`, `stage-filing`, `verify-filings`, and `stage-case …
approved`; harness step 4c (`scripts/lib/source-path.mjs`) with both
tables in every exact-reach proof; the live bridge's intake continuation
(and the bridge lane syncing the ledger after its reset); Maestro
`case-sources.yaml` (22 flows); the records in `security/APPROVALS.md`,
`PRODUCT.md`, `SECURITY.md`, `docs/data-classification.md`, the README
runbook, and `.maestro/README.md`.

### Finds this execution produced

- **Find 62 — a blank Drive path passed the server.** The harness sent
  three spaces as a path; the app refuses it locally (trim, then
  non-empty), the server checked only length and control characters and
  recorded it. The server now trims and refuses a blank path
  (`invalid_path`), stores the trimmed path, and pgTAP 011 pins it
  (assertion 34b).
- **Find 63 — the live client journey did not know the new trail
  families.** With the bridge lane syncing the synthetic ledger, the
  client's trail carried `source.referenced`, and the journey's family
  check (`case`, `request`, `document`) failed; it names `source` and
  `record` now.
- **Find 64 — the emulator's system process died under the first device
  run.** At the instant the extra flow launched the app the Android
  system process threw a fatal exception (`adb logcat -b crash`), every
  app died with `DeadSystemException`, the flow failed at its first wait
  (host frames: the splash, then black), and the runner's clipboard
  scrub could not run (`cmd: Can't find service: package`). The scrub
  was run by hand once the system was back, memory was checked, and the
  lane was run again. A device fault, not an app fault; recorded so the
  next run knows the shape.

### The device run

`security/evidence/2026-09-28-desktop-m5/`: reviewer.rae, on the AAL2
session the runner's login proved, opened the approved case from Home
and read the Sources section (three ledger objects as label, type,
version, as-of, and digest, each "read by HiveSyntheticLedger", no value
anywhere) and the Permanent record section (the July statement
"Verified in the record", the November statement "Did not match the
record" with what the adapter found, each with its path, file id,
filer's role, date, and claimed digest), then "Nothing for you to do on
this case right now". The first run died with the emulator's system
process (find 64) and the second ran end to end; both logs are kept.

### Gates at the candidate, all fresh

| Gate                                                    | Result                                                                                    |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| typecheck                                               | exit 0                                                                                    |
| eslint, max-warnings 0                                  | exit 0                                                                                    |
| prettier, check                                         | exit 0                                                                                    |
| verify:toolchain                                        | OK                                                                                        |
| jest                                                    | **699 passed across 57 suites**                                                           |
| test:scripts (node:test)                                | **368 passed, 0 failed, 36 skipped** (device-lane tests)                                  |
| pgTAP, CLI stack (`supabase test db`)                   | **11 files, 410 asserts, PASS** (suite 011: 54)                                           |
| black-box harness, CLI stack (`local-supabase.mjs e2e`) | **341 passed, 0 failed** on a fresh seed (step 4c, the source path)                       |
| live bridge, CLI stack (`local-supabase.mjs bridge`)    | **10 passed across 5 suites** (the intake continuation among them)                        |
| maestro:validate                                        | OK — 22 flows, 5 helper scripts                                                           |
| db:types:check                                          | committed types match the schema                                                          |
| config:check                                            | OK for profile development                                                                |
| eas:guard                                               | OK                                                                                        |
| audit:gate                                              | OK — two moderate (`uuid`, `decode-uri-component`) below the gate, no waiver on file      |
| secrets:scan, with Kody's ratification record           | OK — 441 tracked files, 1,152 history blobs, 4 exceptions reconciled                      |
| export:candidate (inspects its own output)              | OK — synthetic candidate lane, bundle inspection OK, zero QA-hook markers                 |
| Maestro on `Pixel_8`                                    | `maestro:enroll -- --then case-sources.yaml` OK on the second run (evidence folder above) |

### State

Milestone 5 built, gated, and run on the device on this desktop, against
named synthetic adapters only; the provisional decisions are listed in
`security/APPROVALS.md` for one line from Kody; the live QuickBooks
Online and Drive adapters stay HOLD until their own PASS (C3, C4); the
filing convention against the Recordkeeping Bible (Kody) and whether a
client is ever told of a filing (Stacie) stay open. Committed on
`claude/hive-fable-5-greenfield-p0cwkq`.

Next: Milestone 6, the store release candidate (signed builds,
disclosures, review tenant, support and deletion flows, store assets,
rollback), which is HOLD-bound at almost every step: signing, store
accounts, submission, and release each need Kody's exact authority
before any of it can be executed rather than prepared.
