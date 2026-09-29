# Approval and ratification model

**Approval material never lives in this repository.**

An entry in `security/waivers.json` or `security/secret-scan-allowlist.json`
that says it is ratified proves nothing on its own — the implementer writes
that field. Earlier revisions required a decision record committed under
`security/decisions/`, which was also insufficient for a structural reason:
**a record committed inside a commit cannot name that commit's own hash**, so
an in-repo record can only ever bind some earlier commit. Under the RETURN-5
ruling the record moved out of the repository entirely, and
`security/decisions/` no longer exists.

## The flow

1. The corrective child commit is built and pushed with every waiver and
   history exception still `proposed`. Both gates exit 3 (HOLD).
2. The approver issues a decision record **naming that child's SHA**, which
   now exists. Nothing about the approval is committed.
3. Verification runs at the child with the record and its digest supplied
   through channels the implementer does not control:

   ```
   HIVE_APPROVAL_RECORDS=/path/outside/the/repo/waivers-approval.json
   HIVE_APPROVAL_DIGESTS=<sha256 of that file>
   npm run audit:gate
   npm run secrets:scan
   ```

Both are required. Handing the gate a file is not an approval, and stating a
digest without the record is not one either.

## What a decision record contains

A JSON object binding every one of:

| Field            | Meaning                                                          |
| ---------------- | ---------------------------------------------------------------- |
| `approver`       | The authorized approver (must be in `AUTHORIZED_APPROVERS`)      |
| `role`           | The role they approve in                                         |
| `action`         | `waiver-ratification` or `history-exception-ratification`        |
| `manifestSha256` | Digest of the exact approved entry set (substance, not approval) |
| `candidate`      | The commit approved — the child SHA, which exists by now         |
| `lockfileSha256` | The lockfile the approval is bound to                            |
| `rawAuditSha256` | The archived raw audit evidence it was judged against            |
| `destination`    | Where the approved artifact may go                               |
| `approvedAt`     | Approval timestamp; its date must equal the entry's `ratifiedOn` |
| `expires`        | Expiry; must equal the entry's expiry                            |

The entry itself carries `decisionRecordDigest` and **no path**: it must not
be able to point at material the implementer controls. A surviving
`decisionRecordPath` field is refused.

## What is refused

- A decision record located **inside the repository** — refused by the
  loader before it is read, so committing one can never help.
- A record supplied without its digest stated independently, or a digest
  stated without the record.
- An unauthorized approver, however internally consistent the record.
- A record whose digest does not match, or that was edited after approval.
- An approval naming a different candidate, manifest, lockfile, or raw-audit
  archive — any material change invalidates it.
- A ratification dated in the future, or after the entry's expiry.

## Milestone decisions under Kody's standing instruction

Under Kody's standing instruction of 2026-09-18 ("just RUN"), each
milestone records the product decisions it had to make. None is a HOLD
item; each is reversible by changing one value and re-running the gates.
A one-line reply ("I ratify the Milestone 2 decisions" or "change X to Y")
settles them; until then they stand as built, marked provisional. A
ratification is recorded here with its date and Kody's exact words, and
the candidate it was given at.

### Milestone 2 — controlled document request (WO-003, 2026-09-28)

**Ratified 2026-09-28 by Kody, in writing: "I ratify the Milestone 2 and 3
decisions, start Milestone 4"** (given at candidate `6234f12`).

| Decision                   | As built                                                                                                     | Where it lives                                                                                                 |
| -------------------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Per-file size limit        | 20 MB                                                                                                        | bucket `file_size_limit`; `begin_document_upload`; the table constraint; `DOCUMENT_LIMITS.maxBytes`            |
| Accepted types             | PDF, PNG, JPEG, CSV                                                                                          | bucket `allowed_mime_types`; the function; the constraint; `ALLOWED_MIME_TYPES`                                |
| Documents per request      | 10, counting received, checked, and live reservations; refused and expired do not count                      | `begin_document_upload`; `DOCUMENT_LIMITS.maxPerRequest`                                                       |
| Quarantine retention       | 30 days from receipt; a transfer window of 24 hours before it                                                | `complete_document_upload`; `begin_document_upload`; the sweep                                                 |
| Malware scanning           | **HOLD** for a real scanner. Locally, `HiveSyntheticScanner` recomputes size and digest and refuses a marker | `scripts/lib/synthetic-scanner.mjs`; the server-role scan interface is what any approved scanner will speak to |
| The document's name        | Shown on its request, bounded to 120 printable characters, never in activity, audit details, or logs         | the constraint; `sanitizeDisplayName`                                                                          |
| What a checked document is | A HIVE evidence reference: "Checked", never approved, filed, or final; Drive stays the record, filing manual | `DOCUMENT_STATUS_PRESENTATION`; PRODUCT.md                                                                     |
| Who uploads                | Client users only, on OPEN requests; staff never (the control is absent and the server refuses)              | `client_user_for_scope`; the storage policy; `canAddDocumentTo`                                                |

### Milestone 3 — review and response (WO-004, 2026-09-28)

**Ratified 2026-09-28 by Kody, in writing: "I ratify the Milestone 2 and 3
decisions, start Milestone 4"** (given at candidate `6234f12`).

| Decision                     | As built                                                                                                                                                                                        | Where it lives                                                     |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Answer length                | 4,000 characters; newline and tab allowed, other control characters removed on the phone and refused by the server                                                                              | the table constraint; `save_request_answer_draft`; `ANSWER_LIMITS` |
| What can be cited            | Up to 20 documents, only ones received on the same request (received, being checked, or checked); a citation that is refused or expired before submission refuses the submission                | `citable_document_count`; both functions; `citableDocuments`       |
| One answer per request       | A single record, DRAFT until submitted, then immutable in text, citations, and status; another client user of the workspace cannot take over a draft (answer_changed)                           | `unique (request_id)`; the lifecycle trigger; the draft function   |
| Where the draft lives        | On the server with the request, never on the device; the writer sees it from any device; staff never see a draft                                                                                | `request_answers_select_by_membership`                             |
| What a submission moves      | The request to ANSWERED, one "request answered" activity entry, and an audit receipt carrying lengths and counts, never the text; the case, its attention item, and its next action do not move | `submit_request_answer`; pgTAP suite 009                           |
| Who reads a submitted answer | Client users of the scope; staff of the scope at AAL2 only                                                                                                                                      | the permissive and restrictive policies on both tables             |
| Blank drafts                 | A blank draft can be saved (a person may clear and come back); it cannot be submitted (empty_answer)                                                                                            | `submit_request_answer`; `checkAnswerText`                         |
| The primary action           | On an open request a client user's primary control is "Answer this request"; "Add a document" stands beside it as the secondary control                                                         | `RequestDetailView`                                                |
| The source link              | Seeded only; no client or staff path sets which document a request is about; resolved by its own scoped read, so a link outside the scope could never render a name                             | `requests.subject_document_id`; `loadRequestContext`               |
| Telling Honeybee             | **HOLD**: how Honeybee learns of a submission is a communication contract for Stacie; nothing here notifies anyone                                                                              | the migration header; PRODUCT.md                                   |
| Wording                      | Placeholder client wording for every refusal, state, and the confirmation, Stacie's to replace wholesale                                                                                        | `ANSWER_REFUSAL_WORDING`; the answer view                          |

### Milestone 4 — internal review and approval (WO-005, 2026-09-28)

**Ratified 2026-09-28 by Kody, in writing: "I ratify the Milestone 4
decisions, start Milestone 5"** (given at candidate `eb1a974`).

| Decision               | As built                                                                                                                                                                                                                                                                                               | Where it lives                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| Who freezes            | The assigned preparer, from EVIDENCE_PENDING or from APPROVED (material change); intake never (no accounting decision and no submission for review)                                                                                                                                                    | `freeze_case_package`; `actionsFor`                                                     |
| What a package holds   | Every request of the case with status and version, every submitted answer as id, version, and text digest, every checked document as id, digest, and size; ids and digests only, no names or text; SHA-256 over the canonical manifest                                                                 | `build_case_manifest`; `manifest_digest`                                                |
| Conflict-free          | The person who froze a package does not review it; the person who froze or reviewed it does not approve it; the server refuses (conflict_of_interest) and the screen words it                                                                                                                          | the three transitions; pgTAP 010 (43, 64)                                               |
| Verdicts               | A reviewer records exactly one of PASS, RETURN, HOLD on the review they started; an approver records RETURN or HOLD on a passed package, and PASS by an approver is the approval; a recorded verdict is immutable                                                                                      | `record_case_verdict`; `verdictsFor`                                                    |
| The note               | Up to 2,000 printable characters on the staff-only verdict row; never in activity or audit details; staff of the scope read it, the client never does                                                                                                                                                  | the table constraint; `checkNote`                                                       |
| What moves             | Freeze: READY_FOR_REVIEW; start: IN_REVIEW; PASS: APPROVAL_PENDING; RETURN: RETURNED; HOLD: HOLD; approval: APPROVED; resume: EVIDENCE_PENDING. Each transition appends one enumerated trail entry and one audit receipt; attention items and next actions are not authored (a communication contract) | the transitions; pgTAP 010 (76)                                                         |
| Who resumes            | A preparer from RETURNED and from APPROVED (reopening ends the active approval as reopened); an approver lifts a HOLD                                                                                                                                                                                  | `resume_case`                                                                           |
| The approval binding   | Actor, role (approver), exact scope, the package id and its digest, the package number, the case version, the destination, and a 30-day expiry set by the server                                                                                                                                       | `case_approvals`; `approve_case_package`                                                |
| The destination        | `hive-record` only: the approval covers the HIVE workflow record; Drive filing, delivery, or anything external is its own approval, added only with review                                                                                                                                             | the column check; `APPROVAL_DESTINATION`                                                |
| Expiry                 | 30 days; the server-role sweep ends an expired approval and returns a case still standing on it to APPROVAL_PENDING, told through the trail                                                                                                                                                            | `expire_case_approvals`                                                                 |
| Who reads the workflow | Staff of the row's scope at AAL2 (intake, preparer, reviewer, approver); a client user reads the case status and the enumerated trail only                                                                                                                                                             | the policies; pgTAP 010 (35 to 41)                                                      |
| The staff surface      | Ships in the same binary: a staff Home row opens the case review; the screen offers only the role's action for the case status, and the server refuses everything else; a client reaching the route is told it is for staff                                                                            | `DashboardScreen`; `CaseReviewScreen`; route `app/cases/[id]`                           |
| Lane tooling           | A checked loopback reset (`reset-case a1`) and a staging command (`stage-case a1 <state>`) that signs the staff in for real and calls the transitions; no privileged write to a workflow table                                                                                                         | `scripts/lib/case-reset.mjs`; `scripts/case-stage.mjs`; `scripts/lib/staff-session.mjs` |
| Wording                | Placeholder staff wording for every action, confirmation, refusal, and outcome, and client wording for the eight trail kinds; Stacie's to replace                                                                                                                                                      | `labels.ts`                                                                             |

### Milestone 5 — source adapters (WO-006, 2026-09-28)

**Ratified 2026-09-28 by Kody, in writing: "I ratify the Milestone 5
decisions, start Milestone 6"** (given at candidate `0a243b1`). No live
ledger and no live Drive is touched: both adapters are named synthetic
stand-ins, and the live integrations stay HOLD with their own adapter PASS.

| Decision                   | As built                                                                                                                                                                                                                                                                                                                                                                        | Where it lives                                                                     |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| A reference, never a value | A ledger reference is the object's type, identifier, version, own label (bounded, printable), as-of time, and a SHA-256 over what was read; amounts, balances, and account numbers are not part of the shape at all (data classification: financial values excluded)                                                                                                            | `ledger_references`; the adapter contract in `synthetic-ledger.mjs`                |
| Who records a reference    | The server role alone, through the adapter interface; the app has no write, and the adapter's name is on every row; the local stand-in is `HiveSyntheticLedger`; a live QuickBooks Online adapter is HOLD until its own PASS                                                                                                                                                    | `record_ledger_reference` (grant: service_role); pgTAP 011                         |
| Object types               | Account, JournalEntry, Invoice, Bill, Payment, Report; anything else is refused by the column                                                                                                                                                                                                                                                                                   | the column check                                                                   |
| A reference is immutable   | One row per (case, source, realm, type, id, version); the same object at a new version is a new row; recording it again replays the same id; no update or delete                                                                                                                                                                                                                | the unique key; `ledger_reference_guard`                                           |
| Who reads the sources      | Staff of the row's scope at AAL2; a client never (the trail says "Source referenced", nothing more)                                                                                                                                                                                                                                                                             | the policies; pgTAP 011 (13 to 16)                                                 |
| Filing is by hand          | HIVE never writes to, moves, deletes, or shares anything in Drive; a person files the checked document by hand and records a receipt naming the document, the Drive file id, and the folder path                                                                                                                                                                                | `record_filing_receipt`; the adapter contract in `synthetic-drive.mjs`             |
| Who records a receipt      | Intake or the preparer of the scope, at AAL2, only on an APPROVED case standing on an ACTIVE approval, only for a checked document the approved package covers (a document checked after the freeze is `document_not_approved`); one receipt per document per Drive file (`receipt_exists`); the receipt claims the document's checked digest and binds to the approved package | `record_filing_receipt`; `actionsFor`; pgTAP 011 (23 to 46)                        |
| Receipt lifecycle          | RECORDED, then settled once by the server-role adapter as VERIFIED (the record holds exactly the claimed bytes) or MISMATCH (other bytes, or no object at all); the adapter's name and what it found are kept on the receipt; a settled receipt is never re-settled                                                                                                             | `verify_filing_receipt`; `filing_receipt_lifecycle`                                |
| A filing moves nothing     | The case version and status stand; the approval is not consumed; the trail gets `record.filed`, `record.verified`, or `record.mismatch`; audit details carry ids, statuses, and the adapter name, never a path                                                                                                                                                                  | the functions; the harness step 4c                                                 |
| Bounds                     | Drive file id `^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$`; folder path up to 240 printable characters; the label up to 120                                                                                                                                                                                                                                                              | the column checks; `FILING_LIMITS`; `checkFiling`                                  |
| The staff surface          | The case review gains Sources and Permanent record sections, read by every staff role; the filing form (document chooser among the checked documents, file id, folder path, one confirmation) shows only for intake or the preparer on an approved case; a reviewer or approver reads                                                                                           | `CaseReviewView`; `review-rules.ts`                                                |
| Lane tooling               | `sync-ledger a1` (the synthetic ledger through the server-role interface), `stage-case a1 approved` (a real approver sign-in), `stage-filing a1` (a real intake sign-in), `verify-filings` (the synthetic record adapter, read-only); loopback only, the bearer in memory                                                                                                       | `scripts/ledger-sync.mjs`; `scripts/filing-stage.mjs`; `scripts/filing-verify.mjs` |
| Wording                    | Placeholder staff wording for the sections, the form, the confirmation, the refusals, and the statuses, and client wording for the four trail kinds; Stacie's to replace                                                                                                                                                                                                        | `labels.ts`                                                                        |

### Milestone 6 — store release candidate, preparation within the HOLD boundary (WO-007, 2026-09-28)

**Provisional — awaiting Kody's one-line ratification.** Built on his word
("I ratify the Milestone 5 decisions, start Milestone 6"). Nothing here
signs, submits, publishes, deploys, creates an account, accepts a term,
or touches live data; every such step is a named HOLD row in
`docs/release/signing-and-submission.md`.

| Decision                         | As built                                                                                                                                                                                                                                                                                            | Where it lives                                                                        |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| The kill switch                  | One public status (open or paused; reason none, maintenance, or incident; a minimum app version); flipped by the server role alone with an idempotency key; every change appended to a history; the app reads it at boot and on every return to the foreground with the public key and nothing else | `service_status`; `set_service_state`; `service_status_read`; `ServiceGate`           |
| What a pause does                | A restrictive policy on all seventeen protected tables (memberships included) returns zero rows for every command, and the two actor helpers refuse every reviewed transition with `service_paused`; nothing is removed; the server-role interfaces stay open for operators                         | the `*_service_open` policies; the two helpers; pgTAP 012                             |
| Outside the gate                 | A person's own deletion requests stay readable and makeable while paused                                                                                                                                                                                                                            | `account_deletion_requests` (no gate policy)                                          |
| An unreadable status             | The app proceeds: the server refuses on its own while paused, so the screen is the explanation, never the control; a readable pause or an old app interrupts                                                                                                                                        | `decideServiceGate`                                                                   |
| The minimum app version          | Starts at 0.0.0; raised only by the runbook's incident rule; an older app shows "Update HIVE to continue" and nothing else                                                                                                                                                                          | `service_status.min_app_version`; `compareVersions`                                   |
| Who may ask for deletion         | Any signed-in person for their own account; staff at AAL2 (a sensitive action); one open request at a time; the same key replays; withdrawable until completed; one audit receipt per scope held for each step                                                                                      | `request_account_deletion`; `withdraw_account_deletion`                               |
| Retention, separated             | Deletion removes access and the sign-in account; records the firm keeps for the business (documents, answers, packages, verdicts, approvals, filings) and the audit history are kept, with who acted as a uuid; the screen says so in words; the basis itself is Kody's, the wording Stacie's       | `DELETION_WORDING`; PRODUCT.md                                                        |
| Records outlive accounts         | The record tables' actor columns no longer reference `auth.users` (they stay NOT NULL as pseudonymous references); memberships still cascade away; the request keeps a pseudonymous subject and a null user after the account is removed                                                            | migration 20260928120012 section 3; pgTAP 012 (46, 47)                                |
| Completion                       | The server role completes the open request (audit per scope, memberships removed, the request marked) and the operator tooling removes the auth user through the platform's admin API, then reads back that the account is gone and the records stand; the seed restores a synthetic identity       | `complete_account_deletion`; `scripts/deletion-tools.mjs`                             |
| The deletion control's condition | The Account section renders only when the public deletion page is configured (`EXPO_PUBLIC_DELETION_INFO_URL`); in development a reserved synthetic host is allowed; a release configuration without it, or with a reserved host, fails `config:check`                                              | `env.ts`; `SettingsView`; `checkReleaseContacts`                                      |
| The release contacts             | `EXPO_PUBLIC_SUPPORT_EMAIL` and `EXPO_PUBLIC_DELETION_INFO_URL` are required and never reserved in a release configuration; both are HOLD until Kody supplies them                                                                                                                                  | `scripts/candidate-config-check.mjs`                                                  |
| The disclosures                  | No tracking, no third-party SDK, three collected data types (email, user id, user content) for app functionality only, INTERNET only, standard TLS only, no accessed API categories in the app's own code; reconciled against the code by a gate; the store forms themselves are Kody's             | `docs/release/privacy-disclosures.json`; `scripts/privacy-reconcile.mjs`; app.json    |
| Versioning                       | `version` stays 0.1.0 until Kody names the first release; build numbers are set per build and recorded, never auto-incremented locally                                                                                                                                                              | `docs/release/signing-and-submission.md`                                              |
| The review tenant                | Recommended: a dedicated synthetic review environment with one client review identity whose fixed code is accepted only there, plus a demo video for the staff surface; not built, Kody decides                                                                                                     | `docs/release/review-tenant.md`                                                       |
| Lane tooling                     | `service-status`, `pause-service`, `resume-service`, `reset-deletion` (signs the person in and withdraws as them), `complete-deletion` (server role and admin API), `drill-backup` (pg_dump and pg_restore inside the container, twenty-one tables compared); loopback only                         | `scripts/service-state.mjs`; `scripts/deletion-tools.mjs`; `scripts/backup-drill.mjs` |
| Wording                          | Placeholder wording for the paused and update screens and the deletion section; Stacie's to replace                                                                                                                                                                                                 | `labels.ts`                                                                           |

## Current state

**Ratified.** On 2026-09-07 Kody ratified the four history exceptions in
`security/secret-scan-allowlist.json` in writing ("I ratify the four proposed
history exceptions in security/secret-scan-allowlist.json."). The decision
record was drafted at candidate `986d5a35c2190fc580b9b92d0e77a9d5055f9c02`
(manifest `2f5a5a306e79d72dadd5a333d5e6c53cf63e9d22c3d62560f7c0140bcdaaae4b`,
four entries, shared expiry 2026-11-21), its digest is
`b374a22273b651d1378e14ab2a8b7b47baeb3c706ac0a1b723ac1764db7f66f9`, and the
provenance was applied to the entries in the commit after that candidate. The
record itself lives OUTSIDE this repository, in Kody's custody, and is never
committed; `secrets:scan` exits 0 only when it is supplied out-of-band:

    HIVE_CANDIDATE_SHA=986d5a35c2190fc580b9b92d0e77a9d5055f9c02 HIVE_APPROVAL_RECORDS=<path to the record> HIVE_APPROVAL_DIGESTS=b374a22273b651d1378e14ab2a8b7b47baeb3c706ac0a1b723ac1764db7f66f9 npm run secrets:scan

Without it the gate FAILS (exit 1, "an entry claiming ratification proves nothing on
its own") — a ratification cannot be replayed from repository contents alone. The
exceptions expire on 2026-11-21; after that
date the gate returns to HOLD until the history is rewritten or a new record is
ratified. The two audit waivers were retired on 2026-09-06 by their own recorded
removal condition — the SDK 57 patch refresh dropped `image-size` from the
dependency tree, so neither advisory exists to waive (history preserved in
`security/waivers.json` `$history`); with no waiver on file and only
below-gate moderates in the audit, `audit:gate` exits 0. No signing key and no
approval is invented here.
