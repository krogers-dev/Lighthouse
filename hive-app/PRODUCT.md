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

| Milestone                       | Working result                                                                                              | Explicit exclusions                                                   | Gate                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0. Identity and isolation       | Invite, OTP, MFA, secure session lifecycle, scope selection, empty dashboard                                | All live data and integrations                                        | Work Order 001 (current)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 1. Read-only client dashboard   | Scoped case status, requests, activity, help, source timestamps                                             | No uploads or financial values until contracts pass                   | Requires Milestone 0 PASS _[in progress from 2026-08-22 on Kody's instruction while Milestone 0 is still RETURN; see docs/plans/2026-08-22-milestone1-read-only-dashboard.md]_                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 2. Controlled document request  | System picker, quarantine upload, validation, malware-scan interface, digest, duplicate and expiry controls | No automatic Drive filing; no document becomes evidence automatically | Requires approved scanner, limits, retention _[built 2026-09-28 under Kody's standing instruction; limits and retention are provisional in security/APPROVALS.md; the scanner stays HOLD with a named synthetic stand-in locally; see docs/plans/2026-09-28-wo-003-controlled-document-request.md]_                                                                                                                                                                                                                                                                                                        |
| 3. Review and response          | Client answers, source-linked questions, draft retention, explicit submission                               | No accounting decision or approval by Beth or automation              | Requires communication and record contracts _[built 2026-09-28 under Kody's standing instruction; the limits, the citation rule, and the wording are provisional in security/APPROVALS.md; how Honeybee is told of a submission stays HOLD for Stacie; see docs/plans/2026-09-28-wo-004-review-and-response.md]_                                                                                                                                                                                                                                                                                           |
| 4. Internal review and approval | Frozen package, read-only PASS/RETURN/HOLD, exact expiring approval                                         | Approval is not release, reconciliation, completion, or filing        | Requires conflict-free approvers _[built 2026-09-28 under Kody's standing instruction; the binding, the expiry, the destination, and the conflict rules are provisional in security/APPROVALS.md; see docs/plans/2026-09-28-wo-005-review-and-approval.md]_                                                                                                                                                                                                                                                                                                                                                |
| 5. Source adapters              | QBO read-only references and verified manual Drive filing receipts                                          | No QBO write and no automatic Drive mutation                          | Requires separate adapter PASS _[built 2026-09-28 under Kody's standing instruction against NAMED synthetic adapters only; the reference shape, the filing rules, and the verification are provisional in security/APPROVALS.md; the live QuickBooks Online and Drive adapters stay HOLD; see docs/plans/2026-09-28-wo-006-source-adapters.md]_                                                                                                                                                                                                                                                            |
| 7. Intake and onboarding        | The operator brings a client, an entity, and its people in; staff open a case and ask for what is needed    | No self-registration; no case or request created by automation        | Requires Kody's values for production and his check against the Recordkeeping Bible _[both halves built 2026-09-30 under Kody's standing instruction and "move forward": onboarding (docs/plans/2026-09-30-wo-012-onboarding.md) proven locally and on staging; intake (docs/plans/2026-09-30-wo-013-intake.md) proven locally, on the device, and on staging; the migrations on production; provisional in security/APPROVALS.md]_                                                                                                                                                                        |
| 6. Store release candidate      | Signed builds, disclosures, review tenant, support/deletion flows, store assets, rollback                   | No automatic public release                                           | Requires joint exact-build approval _[prepared 2026-09-28 under Kody's standing instruction within the HOLD boundary: the kill switch, the deletion request, the disclosures and their reconciliation, the backup drill, and the runbooks exist and are proven on the local synthetic stack; signing, accounts, submission, release, and the public pages are HOLD rows in docs/release/signing-and-submission.md; the hosted STAGING project exists since 2026-09-29 with every suite passing on it (docs/release/hosted-project-setup.md); see docs/plans/2026-09-28-wo-007-store-release-candidate.md]_ |

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

### Case lifecycle (review and approval implemented in Milestone 4; intake in Milestone 7)

`DRAFT -> INTAKE_RECORDED -> EVIDENCE_PENDING -> READY_FOR_REVIEW -> IN_REVIEW -> APPROVAL_PENDING -> APPROVED`

Correctable review findings go to `RETURNED`, then back to
`EVIDENCE_PENDING`. Identity, authority, evidence, policy, boundary,
destination, or security gaps go to `HOLD`. `APPROVED` does not mean
released, final, closed, reconciled, filed, archived, or locked.

Intake opens a case as a `DRAFT` the client sees as "Being set up", with
nothing asked of them; recording the intake makes it `INTAKE_RECORDED`
("Received", the trail's "Received by Honeybee"); the first request
intake or the preparer opens moves it to `EVIDENCE_PENDING`, and later
requests, and closing one, leave the case where it is. A draft that
holds nothing can be discarded (WO-013).

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

### Sources and the permanent record (implemented in Milestone 5)

**The review tenant on every plan (WO-009, 2026-09-29).** The store
reviewer's sign-in no longer depends on a hook the hosted platform sells
only on its Teams plan: the server keeps the same rules by a trigger, a
scheduled sweep, and server-side revocation, and the hook returns the day
a plan permits it (`docs/plans/2026-09-29-wo-009-review-tenant-fallback.md`).

**Operating a hosted project (WO-011, 2026-09-30).** The review tenant's
tools and the kill switch run against staging and production from the
operator's machine: the project's secret key is read for one command and
kept nowhere, a change on production needs its project ref repeated, and
the black-box proof runs on staging only
(`docs/plans/2026-09-30-wo-011-hosted-operator-mode.md`). Production
receives the review tenant, the one synthetic thing it will ever hold, at
Kody's word.

**Live client information (direction of 2026-09-29, Kody: "I support what
you recommend").** After the store release candidate and the review-tenant
fallback: first the real read-only QuickBooks Online and Google Drive
adapters behind the Milestone 5 interface, refreshed by a scheduled
server job (references and receipts, never a value; each adapter its own
account, review, and PASS); then instant updates on the phone through the
database's realtime channel and notifications, with a notification policy
and a disclosure change. Live financial numbers in the app: reopened by Kody
the same evening for after go-live, as its own work order delivered by an
app update, with read-through display (shown at request time, not stored)
as the recommended shape and the disclosures, store answers, policy date,
and security review redone before it ships.

QuickBooks Online is the read-only ledger and Drive is the permanent
record; HIVE holds neither. What it holds is a **ledger reference**: the
object's type, identifier, version, own label, as-of time, and a digest
over what was read, recorded only by the server role through a named
adapter, immutable, and never a value (no amount, balance, or account
number exists in the shape). And a **filing receipt**: a person files a
checked document to Drive by hand and records the document, the Drive
file id, and the folder path; the server accepts it only from intake or
the preparer at AAL2, only on an approved case standing on an active
approval, only for a checked document the approved package covers, and
claims the document's checked digest. The named record adapter then
checks, read-only, whether the Drive object holds exactly those bytes:
`RECORDED -> VERIFIED | MISMATCH`, settled once, with what was found kept
on the receipt. A filing moves nothing on the case. Staff read the
sources and the record on the case review; clients see the enumerated
trail. HIVE never writes to the ledger or the record; locally both
adapters are synthetic stand-ins (`HiveSyntheticLedger`,
`HiveSyntheticDrive`), and the live adapters are HOLD until their own
PASS.

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
  public web route exist. _[Milestone 6, 2026-09-28: the backend exists
  (`request_account_deletion`, `withdraw_account_deletion`,
  `complete_account_deletion`, proven in pgTAP 012, the harness, and the
  live bridge); the retention explanation is on the Account screen in
  provisional wording, and the basis it rests on is Kody's to approve; the
  control renders only when the public web route is configured
  (`EXPO_PUBLIC_DELETION_INFO_URL`), which is HOLD until Kody supplies the
  page. Records the firm keeps for the business outlive the account, with
  who acted kept as a pseudonymous id.]_
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

  **Met on staging 2026-09-29**: Resend as the custom SMTP provider on
  Honeybee's own domain, the code template live, and the acceptance below
  passed against the staging project
  (`security/evidence/2026-09-29-hosted-staging/hosted-otp-acceptance.md`).
  The production project passed the same acceptance later the same day
  (`security/evidence/2026-09-29-hosted-production/hosted-otp-acceptance.md`).

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

- **Reviewer accounts (decided 2026-09-29, WO-008):** one review
  identity in a dedicated synthetic review environment signs in with a
  review code the server admits only while a review window is open; the
  hosted hook, the hosted review mailbox, and each window's notes are the
  remaining HOLD steps in `docs/release/signing-and-submission.md`.
- **Store identifiers (decided provisionally 2026-09-29 under Kody's general
  grant):** `com.myhbcfo.hive` on both platforms, "HIVE", scheme `hive`,
  version 1.0.0 (`app.config.js`, `APP_VARIANT=production`); app.json
  stays the development configuration.
- Privacy answers are prepared and reconciled (`docs/release/privacy-disclosures.md`);
  the financial-features declaration, export compliance, and every
  remaining item in the brief's "Decisions Claude must HOLD instead of
  guessing" list are Kody's to submit.
