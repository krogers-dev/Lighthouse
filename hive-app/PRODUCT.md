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

| Milestone                       | Working result                                                                                              | Explicit exclusions                                                   | Gate                                                                                                                                                                           |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0. Identity and isolation       | Invite, OTP, MFA, secure session lifecycle, scope selection, empty dashboard                                | All live data and integrations                                        | Work Order 001 (current)                                                                                                                                                       |
| 1. Read-only client dashboard   | Scoped case status, requests, activity, help, source timestamps                                             | No uploads or financial values until contracts pass                   | Requires Milestone 0 PASS _[in progress from 2026-08-22 on Kody's instruction while Milestone 0 is still RETURN; see docs/plans/2026-08-22-milestone1-read-only-dashboard.md]_ |
| 2. Controlled document request  | System picker, quarantine upload, validation, malware-scan interface, digest, duplicate and expiry controls | No automatic Drive filing; no document becomes evidence automatically | Requires approved scanner, limits, retention                                                                                                                                   |
| 3. Review and response          | Client answers, source-linked questions, draft retention, explicit submission                               | No accounting decision or approval by Beth or automation              | Requires communication and record contracts                                                                                                                                    |
| 4. Internal review and approval | Frozen package, read-only PASS/RETURN/HOLD, exact expiring approval                                         | Approval is not release, reconciliation, completion, or filing        | Requires conflict-free approvers                                                                                                                                               |
| 5. Source adapters              | QBO read-only references and verified manual Drive filing receipts                                          | No QBO write and no automatic Drive mutation                          | Requires separate adapter PASS                                                                                                                                                 |
| 6. Store release candidate      | Signed builds, disclosures, review tenant, support/deletion flows, store assets, rollback                   | No automatic public release                                           | Requires joint exact-build approval                                                                                                                                            |

### Upload lifecycle (later milestone; not implemented in Milestone 0)

`SELECTED -> UPLOADING -> QUARANTINED -> VALIDATING -> ACCEPTED | REJECTED | EXPIRED`

An accepted upload is only a HIVE evidence reference — never the permanent
record. Google Drive remains the permanent record and filing remains manual
until a separate design and approval passes.

### Case lifecycle (later milestone; schema carries the states now)

`DRAFT -> INTAKE_RECORDED -> EVIDENCE_PENDING -> READY_FOR_REVIEW -> IN_REVIEW -> APPROVAL_PENDING -> APPROVED`

Correctable review findings go to `RETURNED`, then back to
`EVIDENCE_PENDING`. Identity, authority, evidence, policy, boundary,
destination, or security gaps go to `HOLD`. `APPROVED` does not mean
released, final, closed, reconciled, filed, archived, or locked.

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
