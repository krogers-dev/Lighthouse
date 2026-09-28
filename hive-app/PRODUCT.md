# PRODUCT.md — What HIVE is and is not

**Legal developer:** MYHBCFO, LLC dba Honeybee Accounting (Honeybee is one word).
**Product owner:** Kody. **Operations owner:** Stacie.
**Status:** Greenfield. Implementation RETURN; production, live data, integrations, signing, submission, and public release HOLD.

## HIVE's job

HIVE is a client clarity and controlled-workflow application for Honeybee
Accounting clients and staff. For any matter it answers exactly five
questions:

1. Where does this matter stand?
2. What needs attention?
3. What evidence or source supports it?
4. Who owns the next action?
5. What can the current user safely do now?

The core visual grammar is one status, one attention item, its
evidence/context, and one next action. HIVE never makes a user decode
accounting-software language.

## What HIVE is not

HIVE is **not** a ledger, a document repository, a CRM, a chat archive, or an
autonomous accounting system.

## System-of-record boundaries

| System            | Authority                                     |
| ----------------- | --------------------------------------------- |
| QuickBooks Online | The ledger, read-only from HIVE's perspective |
| Google Drive      | The permanent record                          |
| HIVE              | Workflow, review, and approval state          |
| Twenty            | Relationship state                            |
| Slack             | Internal coordination only                    |

HIVE never becomes the permanent record, never writes to QBO, and never
takes relationship-state authority from Twenty.

## Audiences

- Client owner or authorized client user.
- Beth: intake, document collection, indexing, follow-up, and status
  tracking only. No accounting decisions or approvals.
- Assigned preparer.
- Read-only conflict-free reviewer.
- Conflict-free approver.
- Kody: product, systems, analysis, security, and technical-QC owner.
- Stacie: operations and client-experience owner.

Department or employee status alone grants no record access. Every user also
needs an exact environment, client, and legal-entity membership.

## First release (V1) surface

Client navigation uses at most five labeled top-level destinations: Home,
Requests, Activity, Help, Account. Staff-only routes remain absent from the
client binary until server authorization, role separation, and internal
workflow tests pass; unsafe staff controls are never hidden in the client
binary and called protected.

## Roadmap and gates

| Milestone                       | Working result                                                                                              | Explicit exclusions                                                   | Gate                                                                                                                                                                                                                                                                                                             |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0. Identity and isolation       | Invite, OTP, MFA, secure session lifecycle, scope selection, empty dashboard                                | All live data and integrations                                        | Work Order 001 (current)                                                                                                                                                                                                                                                                                         |
| 1. Read-only client dashboard   | Scoped case status, requests, activity, help, source timestamps                                             | No uploads or financial values until contracts pass                   | Requires Milestone 0 PASS _[in progress from 2026-08-22 on Kody's instruction while Milestone 0 is still RETURN; see docs/plans/2026-08-22-milestone1-read-only-dashboard.md]_                                                                                                                                   |
| 2. Controlled document request  | System picker, quarantine upload, validation, malware-scan interface, digest, duplicate and expiry controls | No automatic Drive filing; no document becomes evidence automatically | Requires approved scanner, limits, retention _[built 2026-09-28 under Kody's standing instruction; limits and retention are provisional in security/APPROVALS.md; the scanner stays HOLD with a named synthetic stand-in locally; see docs/plans/2026-09-28-wo-003-controlled-document-request.md]_              |
| 3. Review and response          | Client answers, source-linked questions, draft retention, explicit submission                               | No accounting decision or approval by Beth or automation              | Requires communication and record contracts _[built 2026-09-28 under Kody's standing instruction; the limits, the citation rule, and the wording are provisional in security/APPROVALS.md; how Honeybee is told of a submission stays HOLD for Stacie; see docs/plans/2026-09-28-wo-004-review-and-response.md]_ |
| 4. Internal review and approval | Frozen package, read-only PASS/RETURN/HOLD, exact expiring approval                                         | Approval is not release, reconciliation, completion, or filing        | Requires conflict-free approvers _[built 2026-09-28 under Kody's standing instruction; the binding, the expiry, the destination, and the conflict rules are provisional in security/APPROVALS.md; see docs/plans/2026-09-28-wo-005-review-and-approval.md]_                                                      |
| 5. Source adapters              | QBO read-only references and verified manual Drive filing receipts                                          | No QBO write and no automatic Drive mutation                          | Requires separate adapter PASS                                                                                                                                                                                                                                                                                   |
| 6. Store release candidate      | Signed builds, disclosures, review tenant, support/deletion flows, store assets, rollback                   | No automatic public release                                           | Requires joint exact-build approval                                                                                                                                                                                                                                                                              |

### Upload lifecycle (implemented in Milestone 2)

`SELECTED -> UPLOADING -> QUARANTINED -> VALIDATING -> ACCEPTED | REJECTED | EXPIRED`

`SELECTED` is the phone's state (a file picked and checked, nothing sent);
the server row exists from `UPLOADING`, when a path in the quarantine
bucket is reserved. `EXPIRED` is reachable from the three live states: a
transfer that never completed (24 hours) or a received document past its
retention (30 days). In client language a received document is "Received,
being checked"; `ACCEPTED` is "Checked" and `REJECTED` is "Not accepted".

An accepted upload is only a HIVE evidence reference — never the permanent
record. Google Drive remains the permanent record and filing remains manual
until a separate design and approval passes.

### Answer lifecycle (implemented in Milestone 3)

`DRAFT -> SUBMITTED`

One answer per request, written by a client user in words (up to 4,000
characters) and pointing at any of the request's received documents. The
draft lives on the server with the request, never on the device, and is
visible to its writer from any device and to no one at Honeybee. One
explicit submission, confirmed on the phone, settles it: the answer
becomes immutable, the request moves to `ANSWERED`, the activity trail
gains "request answered", and nothing about the case moves. In client
language a submitted answer is "Submitted" and the request "Answered";
nothing is approved, reviewed, or decided by an answer. A question can be
about a document (the request's source link, seeded only for now); how
Honeybee learns of a submission is a communication contract still to be
approved.

### Case lifecycle (review and approval implemented in Milestone 4; intake later)

`DRAFT -> INTAKE_RECORDED -> EVIDENCE_PENDING -> READY_FOR_REVIEW -> IN_REVIEW -> APPROVAL_PENDING -> APPROVED`

Correctable review findings go to `RETURNED`, then back to
`EVIDENCE_PENDING`. Identity, authority, evidence, policy, boundary,
destination, or security gaps go to `HOLD`. `APPROVED` does not mean
released, final, closed, reconciled, filed, archived, or locked.

From `EVIDENCE_PENDING` the assigned preparer freezes the case's evidence
into a review package (every request, every submitted answer, every
checked document, as ids and digests under one SHA-256) and the case is
`READY_FOR_REVIEW`. A conflict-free reviewer, at AAL2, takes it into
`IN_REVIEW` and records exactly one of PASS (`APPROVAL_PENDING`), RETURN
(`RETURNED`), or HOLD (`HOLD`); review is read-only. A conflict-free
approver approves the exact package by id and digest, for the HIVE record
only, and the approval is bound to actor, role, scope, package, case
version, destination, and a 30-day expiry; a new package or a reopened
case supersedes it, and expiry returns the case to `APPROVAL_PENDING`.
An approver may instead RETURN or HOLD a passed package; a preparer
resumes a returned or approved case, an approver lifts a hold. Clients
see the case status and the enumerated trail; the package, the verdicts,
and the approvals are staff reads at AAL2. Intake's `DRAFT ->
INTAKE_RECORDED -> EVIDENCE_PENDING` steps are a later milestone.

## Gate model

Every report uses **PASS**, **RETURN**, or **HOLD** at a named level:
checkpoint, milestone, release candidate, or production release.

- **PASS** needs current evidence for that exact level and never implies a
  higher gate.
- **RETURN** means the defect is bounded, an owner and acceptance test are
  named, no affected capability is represented as complete, and safe
  independent work continues.
- **HOLD** means required authority, source, control, account, asset, legal
  answer, destination, or evidence is missing; only the affected action is
  blocked.

## Recorded release dependencies (not implemented in Milestone 0)

- **Account deletion:** app stores require an in-app account-deletion
  initiation and (Google) a public web deletion resource once account
  creation exists. HIVE renders **no** account-deletion control until its
  complete authorized backend, a retention explanation that separates
  access deletion from records retained under an approved basis, and the
  public web route exist. This is recorded here as a release dependency for
  the store-release milestone; the Milestone 0 settings screen exposes
  sign-out and account-access information only.
- **Hosted OTP email delivery (Supabase change of June 3, 2026):** HIVE's
  sign-in email must deliver the six-digit `{{ .Token }}` via a customized
  template, and every authorized recipient must actually receive it. New
  Free-tier Supabase projects using the default email provider can no
  longer customize email templates.

  **A paid plan alone does not satisfy this dependency.** The built-in
  default email service is a non-production convenience: it delivers only
  to project-team member addresses and is rate-limited, so authorized
  client and staff recipients who are not on the project team would simply
  not receive their sign-in code. Hosted staging and release therefore
  require **either a controlled custom SMTP provider or an approved Send
  Email Hook** — configured, owned, and reviewed by us — regardless of
  plan tier.

  Acceptance is black-box, against the hosted stack, before any hosted
  sign-in is offered to a real recipient:
  1. request a code for an **owned QA recipient that is NOT a project-team
     member** (the case the default provider silently fails);
  2. the delivered message contains **exactly one** six-digit token and no
     magic link;
  3. sign-in completes by **entering that code**, with no link followed;
  4. a request for an **unknown/unauthorized email** yields no account and
     no usable code (self-registration stays disabled).

  Release **HOLD** dependency. No provider is configured now, and none may
  be configured without Kody's exact authority for the exact destination.
  The local pinned stack (Mailpit + the local template) is unaffected and
  is what the current evidence covers.

- Store identifiers, privacy answers, financial-features declaration,
  export compliance, reviewer accounts, and all items in the brief's
  "Decisions Claude must HOLD instead of guessing" list remain HOLD.
