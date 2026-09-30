# Work Order 007 — Milestone 6: Store release candidate (preparation within the HOLD boundary)

**Status: executed 2026-09-28 on Kody's desktop, under Kody's standing
instruction of 2026-09-18 ("just RUN"), started on his word the same day
("I ratify the Milestone 5 decisions, start Milestone 6").** Milestone 6
is the milestone the brief holds at almost every step: signing, store
accounts, submission, release, the hosted project, live data, and the
public pages each need Kody's exact authority. This work order therefore
builds and proves everything that needs no such authority, and turns the
rest into an exact unblock ledger with the evidence each item will need.
Every product decision it needed is recorded as provisional in
`security/APPROVALS.md`. No account was created, no term accepted, nothing
signed, submitted, published, or deployed, and no live data touched.

**Owner:** Kody (acceptance, security, the release authorities).
**Client experience and wording:** Stacie.

## 1. Outcome

Two release controls exist and are proven: a **service kill switch** that
pauses HIVE without removing anything (zero rows and refused transitions
for every client and staff member, an explicit screen in the app, a
minimum app version that shows an update screen, the server role's
switch with replay and an append-only history), and the **account
deletion request** the stores require (an in-app request through one
confirmation, withdrawable, completed by the server role with the
memberships removed and the request kept as a record, the auth user
removed through the platform's admin API, and the records the firm keeps
for the business untouched). The **privacy disclosures** are prepared and
reconciled against the code by a gate; the **iOS privacy manifest** is
declared; the **backup and restore drill** runs on the local stack; the
**rollback runbook**, the **signing and submission checklist**, the
**store listing draft**, and the **review tenant options** are written
with the authority each step needs.

Explicitly excluded, all HOLD: production identifiers, the hosted
project and its email delivery, the support address and the public
deletion page, Apple and Google accounts, certificates, a production
EAS profile, any build for a device, any submission, any release, the
review-account mechanism, the privacy policy text, and the store forms
themselves.

## 2. Requirements

### Functional

- R1. `service_status`: one row (open or paused, an enumerated reason, a
  minimum app version, a version), readable by anyone through
  `service_status_read()` only; `service_status_changes` append-only;
  `set_service_state` server role only, idempotent by key, validating
  every field.
- R2. A restrictive `service_open` policy on all seventeen protected
  tables for every command; `client_user_for_scope` and
  `staff_member_for_scope` refuse first with `service_paused`, so every
  reviewed transition since WO-003 is covered by two edits.
- R3. The app reads the status at boot and on every return to the
  foreground with the public key and nothing else; a readable pause or an
  app below the minimum shows one explicit screen; an unreadable status
  proceeds, because the server refuses on its own.
- R4. `account_deletion_requests`: own-row reads; `request_account_deletion`
  and `withdraw_account_deletion` for the signed-in person (staff at AAL2),
  idempotent by key, one open request at a time, one audit receipt per
  scope held; `complete_account_deletion` for the server role (audit per
  scope, memberships removed, the request marked); the record outlives the
  auth user (user id set null, a pseudonymous subject reference kept).
- R5. The record tables' actor columns no longer reference `auth.users`:
  records outlive the accounts that made them, with who acted kept as a
  uuid (documents, answers, packages, verdicts, approvals, filings).
- R6. The Account screen carries the deletion section only when the
  public deletion page is configured, explains what is removed and what is
  kept, and drives request and withdrawal through confirmations with every
  refusal worded.
- R7. `config:check --profile release` requires the support address and
  the deletion page and refuses reserved domains; `privacy:reconcile`
  reconciles the disclosure against dependencies, permissions, the
  manifest, export compliance, host literals, and the classification.
- R8. Lane tooling: `service-status`, `pause-service`, `resume-service`,
  `reset-deletion` (as the person), `complete-deletion` (the server role
  and the admin API), `drill-backup`.

### Non-functional

- N1. Synthetic identities and data only; the deletion drill runs on the
  identity with no memberships and the seed restores it.
- N2. Nothing signed, submitted, published, deployed, or configured for
  any of those; `eas:guard` unchanged.
- N3. The gates of the previous milestones, all fresh, plus pgTAP 012,
  harness step 4d, the live bridge's release-controls suite, two device
  flows, the backup drill, and the deletion completion drill.

## 3. Threat deltas

- T-M6-1 **The switch is flipped by a client or staff.** Server role only,
  proven with real JWTs and in pgTAP; the app has no path to it.
- T-M6-2 **A pause removes or moves data.** Nothing is deleted; the
  restrictive policy hides rows and the helpers refuse; pgTAP counts the
  rows and receipts before and after.
- T-M6-3 **A deletion erases the firm's records or the audit history.**
  Completion removes memberships only; records keep their actor uuid; the
  request itself is kept; audit receipts are append-only; the drill counts
  them.
- T-M6-4 **A person deletes someone else's account, or asks twice.** Own
  rows only; one open request per subject; another person's withdrawal is
  `no_open_request`.
- T-M6-5 **A disclosure drifts from the build.** The reconciliation gate
  fails the build.
- T-M6-6 **A release configuration ships with a synthetic contact.**
  `config:check --profile release` refuses reserved domains.

## 4. Acceptance tests

- pgTAP `012_milestone6_release_controls.test.sql` (47) and the
  restrictive-layer counts in suites 007 to 011 (now two layers each);
  `002` names eighteen readable tables.
- jest: `service-status`, `service-gate`, `env` (the deletion page rule),
  `account`, `deletion-flow`, `useDeletionRequest`, `settings-view`.
- node:test `release-controls.test.mjs`: the switch library, the backup
  drill's comparison, the release contacts rule, the reconciliation
  checks.
- Harness step 4d (`scripts/lib/release-controls-path.mjs`): the switch
  refused to client and staff; pause, replay, the anonymous status read,
  zero rows for client and staff, a refused transition, the deletion
  request while paused; resume and the rows back; the request lifecycle;
  exact reach with the new table.
- Live bridge `release-controls-live.test.ts`: the public status; the
  request, its replay, the refusal, the withdrawal, through the shipped
  composition.
- Maestro `service-paused.yaml` and `account-deletion.yaml`.
- Drills: `drill-backup` (twenty-one tables, identical counts) and
  `complete-deletion nomember.norman@example.invalid` (the auth user gone,
  the request kept, the seed restoring the identity).

## 5. Decisions made under the standing instruction (provisional)

Recorded in `security/APPROVALS.md` under "Milestone 6": the switch and
its reasons; the gate's tables and the deletion table outside it; the
app's unreadable-status rule; the minimum app version; who may request
deletion and at what assurance; the retention separation and its wording;
the record columns detached from auth users; the completion mechanism;
the release contacts rule; the disclosure answers and the reconciliation;
the versioning rule; the review-tenant recommendation; the lane tooling.

## 6. Dependencies and rollout controls

- C1. `eas:guard` stays as it is: no signed or submitted lane is
  configured; widening it is a written decision (checklist step 6).
- C2. Every HOLD item is a named row in `docs/release/signing-and-submission.md`
  with the authority it needs and the evidence it produces.
- C3. The switch's hosted custody (who may pause a hosted project, from
  where) is decided before a hosted project exists.
- D1. Kody: production identifiers; the hosted project and its email
  delivery; the support address; the public deletion page; the Apple and
  Google accounts; the review-tenant option; the financial-features
  declaration; the store forms.
- D2. Stacie: the listing copy; the wording of the paused screens and the
  deletion section; whether a client is told of a completed deletion
  beyond the confirmation email.
- D3. Kody and Stacie: the privacy policy and the retention basis the
  deletion explanation rests on.

## 7. Execution record

See "Milestone 6 execution record" below, written as the lanes ran.

## Milestone 6 execution record — 2026-09-28, Kody's desktop

Built in the same local session as Milestones 2 to 5, from the
Milestone 5 candidate (`0a243b1`) and its ratification record
(`cf0e6c8`), on the same Docker stack (Supabase CLI 2.115.0), emulator
`Pixel_8` (API 35), Maestro 2.10.0, Node 22.23.2, the Milestone 2 QA
build reused unchanged (no native module was added), Metro restarted
for each bundle and the served bundle checked for the new ids before
every device run.

### Checkpoint 1 — the release controls on the server

Migration `20260928120012_milestone6_release_controls.sql`: the status
row and its append-only history; `service_status_read` for anyone;
`set_service_state` for the server role, run AS the server role;
`app_private.service_open` and the restrictive `*_service_open` policy
on all seventeen protected tables; the two actor helpers refusing first
with `service_paused`; `account_deletion_requests` with own-row reads
and a one-way lifecycle guard; the request, withdrawal, and completion
functions; and the record tables' actor columns detached from
`auth.users`. pgTAP `012` (47) proves the pause (zero rows, refused
transitions, nothing removed, the deletion request still reachable),
the resume, the validation, and the deletion lifecycle through to the
account's removal with the records standing; suites `007` to `011` now
count two restrictive layers per table; `002` names eighteen readable
tables.

### Checkpoint 2 — the app

`readServiceStatus` and `decideServiceGate` in core; the `ServiceGate`
around the whole app (a neutral starting screen until the first read
settles, then the app, the paused screen, or the update screen; a read
on every return to the foreground); the account repository and the
deletion request flow on the Account screen, rendered only with the
public deletion page configured; the environment rule for that page;
the iOS privacy manifest in app.json; the wording for every state.

### Checkpoint 3 — the gates, the tooling, the records

`privacy:reconcile` and its machine-readable disclosure;
`config:check --profile release` requiring real contacts; the switch,
deletion, and backup tooling; harness step 4d; the live bridge's
release-controls suite; the two device flows; the release documents
under `docs/release/` (privacy disclosures, rollback runbook, signing and
submission checklist, store listing draft, review tenant options); the
records in `security/APPROVALS.md`, `PRODUCT.md`, `SECURITY.md`,
`docs/data-classification.md`, the README runbook, and
`.maestro/README.md`.

### Finds this execution produced

- **Find 65 — the server-role functions were declared security definer.**
  `require_server_role` reads `current_user`, and a security-definer body
  reports its owner; pgTAP 012 refused the switch on its first run. Both
  server-role functions now run as the caller, as every server-role
  interface since WO-003 does.
- **Find 66 — the record tables' foreign keys blocked account deletion.**
  Deleting the auth user of a person who had given a document violated
  `document_uploads_created_by_fkey`; pgTAP 012 caught it. The six actor
  columns keep their uuids and no longer reference `auth.users`
  (retention separated from access, as PRODUCT.md records), and pgTAP
  proves the documents remain after the account is gone.
- **Find 67 — a cold boot during a pause signed the person out.** On the
  device, the app relaunched while paused booted its auth machine
  underneath the gate, read zero memberships (the gate hides them), and,
  fail-closed, ended the session with reason `no_access`. The gate now
  shows a neutral starting screen and mounts nothing until its first
  status read settles; jest pins it and the device lane was run again.
- **Find 68 — a notice's spoken tone prefix.** The new flows asserted a
  notice title without the "Warning:" and "Done:" the notice prints
  before it (whole-caption matching); the assertions carry the prefix
  now.
- **Find 69 — the host capture watcher dropped its markers.** Passing a
  marker with a space as a separate argument split it; the passing runs'
  frames came from the flows' own `takeScreenshot` steps and explicit
  captures instead.

### The device run

`security/evidence/2026-09-28-desktop-m6/`: with the service paused by
the server role, the app showed the paused screen with its reason and
nothing of the app, and "Try again" kept it; after the resume the
sign-in flow reached Home; signed in as client.owner, the Account screen
explained deletion, took the request through one confirmation, showed
the open request with its date and the way to withdraw it, and took the
withdrawal through its own confirmation; the identity with no
memberships was deleted end to end through the operator tooling and
restored by the seed. The first pass produced finds 67 and 68; the
second pass, on the corrected bundle, is the one kept.

### Gates at the candidate, all fresh

| Gate                                                             | Result                                                                                                                |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| typecheck                                                        | exit 0                                                                                                                |
| eslint, max-warnings 0                                           | exit 0                                                                                                                |
| prettier, check                                                  | exit 0                                                                                                                |
| verify:toolchain                                                 | OK                                                                                                                    |
| jest                                                             | **732 passed across 62 suites**                                                                                       |
| test:scripts (node:test)                                         | **372 passed, 0 failed, 36 skipped** (device-lane tests)                                                              |
| pgTAP, CLI stack (`supabase test db`)                            | **12 files, 457 asserts, PASS** (suite 012: 47)                                                                       |
| black-box harness, CLI stack (`local-supabase.mjs e2e`)          | **373 passed, 0 failed** on a fresh seed (step 4d, the release controls)                                              |
| live bridge, CLI stack (`local-supabase.mjs bridge`)             | **12 passed across 6 suites** (the release-controls suite among them)                                                 |
| backup drill (`drill-backup`)                                    | OK — 21 tables restored with identical counts                                                                         |
| deletion drill (`request-deletion`, `complete-deletion`, `seed`) | OK — the account gone, the request kept, the identity restored                                                        |
| maestro:validate                                                 | OK — 24 flows, 5 helper scripts                                                                                       |
| db:types:check                                                   | committed types match the schema                                                                                      |
| config:check (development)                                       | OK                                                                                                                    |
| config:check --profile release                                   | **FAILS by design** — eight findings, each a named HOLD (identifiers, origin, the support address, the deletion page) |
| eas:guard                                                        | OK — still the one simulator profile, no submit lane                                                                  |
| privacy:reconcile                                                | OK — 24 dependencies, 112 source files, the manifest, the permissions, and the export answer match the disclosure     |
| audit:gate                                                       | OK — moderate advisories below the gate, no waiver on file                                                            |
| secrets:scan, with Kody's ratification record                    | OK — 465 tracked files, 1,208 history blobs, 4 exceptions reconciled                                                  |
| export:candidate (inspects its own output)                       | OK — synthetic candidate lane, bundle inspection OK                                                                   |
| Maestro on `Pixel_8`                                             | `service-paused.yaml`, `sign-in.yaml` (recovery), `account-deletion.yaml` OK (evidence folder above)                  |

### State

Milestone 6 prepared, gated, drilled, and run on the device on this
desktop, entirely within the HOLD boundary: the kill switch and the
deletion request exist and are proven; the disclosures are reconciled;
the drills pass; the runbooks name every step that still needs Kody's
exact authority. The provisional decisions are listed in
`security/APPROVALS.md` for one line from Kody. The release itself
cannot proceed past `config:check --profile release` until the
identifiers, the hosted origin, the support address, and the deletion
page exist, and past the checklist until the accounts, the signing, and
the joint exact-build approval do. Committed on
`claude/hive-fable-5-greenfield-p0cwkq`.

Next: whatever Kody grants first from `docs/release/signing-and-submission.md`;
until then, the wording review with Stacie and the review-tenant
decision are the only open work that needs no account.

## Execution under Kody's general grant — 2026-09-29

**Kody, in writing: "I grant you all authorities to complete this
project."** Recorded in `security/APPROVALS.md` with how it is read: it
covers every preparation that needs no external account, no spending, no
accepted term, and no value only Kody can supply; it is not read as
authority to create accounts, pay, accept terms, submit, or release, and
none of those was done. Under it:

- **The production configuration exists** (`app.config.js`,
  `APP_VARIANT=production`): `com.myhbcfo.hive` on both platforms,
  "HIVE", scheme `hive`, version 1.0.0, build 1; app.json stays the
  development configuration that every device flow and the candidate
  lane carry. `config:check --profile release` evaluates the variant, so
  its findings are now exactly the values Kody supplies (the hosted
  origin and its manifest entry, the support address, the public
  deletion page); the candidate export's configuration digest covers the
  variant file; `tests/scripts/app-variant.test.mjs` pins the variant and
  the check.
- **The hosted project's setup is written down** in order
  (`docs/release/hosted-project-setup.md`), for the moment Kody creates
  it: migrations, the auth settings that mirror the local configuration
  (the review hook among them), email delivery and its acceptance, the
  approved origin, identities by invitation, the review tenant, the
  public contacts, the kill switch's custody, backups.
- **The public deletion page is drafted** (`docs/release/deletion-page.md`)
  in the words the app uses, for Stacie's approval and Kody's site; the
  **privacy policy is not drafted**: a fact sheet tied to the gates
  (`docs/release/privacy-policy-facts.md`) is prepared for whoever writes
  it.
- **The reviewer demo video** of the staff surface was recorded on the
  emulator from reviewer.rae's real AAL2 session, starting only after the
  login, and kept outside the repository in Kody's approvals folder.
- **The checklist** (`docs/release/signing-and-submission.md`) now marks
  step 1 decided, steps 2 to 5 as Kody's own actions with the prepared
  material each one needs, step 6 covered by the grant but executed only
  once the accounts exist, and step 11 as the exact-build approval the
  grant does not name.

Evidence: `security/evidence/2026-09-29-desktop-release-config/`.
