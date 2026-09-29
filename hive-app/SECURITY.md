# SECURITY.md — HIVE threat model and controls (Milestone 0)

## Assets

1. Client identity and session material (Supabase session tokens on device).
2. Environment / client / legal-entity scope boundaries and memberships.
3. HIVE workflow metadata (case status, attention items, next actions).
4. Append-only audit receipts.
5. The integrity of the release pipeline (no secrets in source, bundles, or history).

Milestone 0 holds **synthetic data only**; the controls are built as if the
data were real.

## Actors

| Actor                                              | Trust                                                                               |
| -------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Anonymous network client                           | Untrusted                                                                           |
| Authenticated client user (AAL1)                   | Trusted only for exact memberships, read-only                                       |
| Staff roles (intake, preparer, reviewer, approver) | Trusted for role capabilities at AAL2, per membership                               |
| The mobile app itself                              | **Untrusted** — it may hold only the Supabase URL and an approved public client key |
| Postgres + RLS + reviewed server functions         | The authorization authority                                                         |
| Local seed/admin harness (dev machine only)        | Privileged; its key never reaches the app                                           |

## Trust boundaries

1. Device ↔ Supabase Auth (identity and session only; no membership authority).
2. Device ↔ Postgres Data API (every row filtered by RLS membership checks).
3. Secure storage ↔ app memory (versioned, digest-verified adapter; quarantine on any doubt).
4. Environment ↔ environment: separate Supabase project and credentials per environment; `environment_id` on every row is defense in depth, not the primary isolation.
5. Client ↔ client and entity ↔ entity inside one environment: RLS membership tuples; composite foreign keys prevent scope mismatch at write time.

Enforcement is Postgres RLS plus reviewed server-side transitions — never UI
state, never client-supplied scope, never `user_metadata` (membership lives
in server-controlled tables).

## Threat cases and required behavior

| Threat                                                                                            | Required behavior                                                                                                                                                                                                                                                                                                                                                   | Verified by                                            |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| BOLA/IDOR by guessed case ID                                                                      | Deny before content serialization; zero protected fields returned                                                                                                                                                                                                                                                                                                   | pgTAP cross-scope tests                                |
| Wrong client/entity in route or deep link                                                         | Untrusted scope ignored; membership verified server-side; deny                                                                                                                                                                                                                                                                                                      | ScopeKey construction rules + repository tests         |
| Missing scope tuple in a query or mutation                                                        | Type/test failure — repositories require a ScopeKey; DB columns are NOT NULL                                                                                                                                                                                                                                                                                        | TS types + pgTAP constraints                           |
| Stale membership/JWT                                                                              | Server rechecks current membership at query time; if the user holds ANY staff membership, every protected select additionally requires an `aal2` JWT claim at RLS — across all of that user's memberships, including client-role ones (a missing claim counts as aal1 and fails closed)                                                                             | RLS subqueries + pgTAP staff-AAL and mixed-role suites |
| Client attempts role/boundary change                                                              | RLS/grant denial; scope columns immutable by trigger                                                                                                                                                                                                                                                                                                                | pgTAP negative tests                                   |
| Duplicate or replayed mutation                                                                    | (No client mutations exist in M0) — protected-mutation contract: idempotency key, object version, exact scope, server time, atomic audit receipt                                                                                                                                                                                                                    | Contract recorded; enforced from Milestone 1           |
| Stale object version                                                                              | Conflict, refresh required, no overwrite                                                                                                                                                                                                                                                                                                                            | Contract recorded; enforced from Milestone 1           |
| Interrupted sign-out / failed SecureStore deletion                                                | Protected UI removed; `storage_quarantined`; only scrub recovery                                                                                                                                                                                                                                                                                                    | Auth machine + controller regression tests             |
| Reinstall with iOS Keychain remnant                                                               | Pre-auth purge and verification, or quarantine                                                                                                                                                                                                                                                                                                                      | Install-marker tests                                   |
| Malformed/corrupt session chunks                                                                  | Quarantine; no partial recovery, no session evaluation                                                                                                                                                                                                                                                                                                              | Secure-store adapter tests                             |
| Late listener after identity switch                                                               | Ignored by auth epoch                                                                                                                                                                                                                                                                                                                                               | Controller epoch tests                                 |
| Offline app with prior session                                                                    | No persistent protected response cache; safe recovery state                                                                                                                                                                                                                                                                                                         | Boot tests; no cache layer exists                      |
| Sensitive value passed to diagnostics                                                             | Redaction replaces it; allowlist drops unknown fields                                                                                                                                                                                                                                                                                                               | Diagnostics tests                                      |
| Untrusted deep-link input                                                                         | Route params never become scope; allowlisted navigation only                                                                                                                                                                                                                                                                                                        | Tenancy rules + route guard                            |
| Secret reaches source, history, or bundle                                                         | Secret gate (pinned scanner + canary + history scan) and bundle inspection fail the build                                                                                                                                                                                                                                                                           | scripts/secret-scan.mjs, scripts/bundle-inspect.mjs    |
| Client writes a document row or object directly (WO-003)                                          | No client grant beyond SELECT on `document_uploads`; the only writes are two reviewed functions that verify the caller's `client_user` membership in the exact scope, the request's scope, status and version, every limit, and the cap; the bucket admits one INSERT at a reserved path                                                                            | pgTAP suite 008; black-box harness step 3b             |
| Staff, or a mixed-role user at AAL1, uploads (WO-003)                                             | The functions and the storage policy apply the global staff-AAL2 rule; staff are refused (42501) even at AAL2 since they hold no client membership; the control is absent from their screens                                                                                                                                                                        | pgTAP suite 008; harness step 3b                       |
| Quarantined object read back, listed, overwritten, deleted                                        | No SELECT/UPDATE/DELETE policy on `storage.objects` for any client role; `(bucket, name)` unique; `upsert` off; the storage service refuses direct row deletion                                                                                                                                                                                                     | pgTAP suite 008; harness step 3b; live bridge          |
| Document declared one thing, transferred another                                                  | Completion refuses a size mismatch; the scan recomputes the digest over what arrived; identity columns immutable after insert; a finished row immutable entirely                                                                                                                                                                                                    | pgTAP suite 008; `scripts/lib/synthetic-scanner.mjs`   |
| Replay or duplicate reservation                                                                   | Idempotency key unique per request and actor returns the same reservation; the cap counts live reservations; a replayed reservation that completed needs no second transfer                                                                                                                                                                                         | pgTAP suite 008; `useAddDocument` tests                |
| Client writes an answer row or a citation directly (WO-004)                                       | No client grant beyond SELECT on `request_answers` and `request_answer_citations`; the only writes are two reviewed `security definer` functions that verify the caller's `client_user` membership in the exact scope, the request's scope, status and version, the draft's version, the text bound, and that every citation is a document received on that request | pgTAP suite 009; black-box harness step 3c             |
| Staff, or a mixed-role user at AAL1, reads a draft or writes an answer (WO-004)                   | Drafts are visible to client users of the scope only; staff read SUBMITTED answers at AAL2 and nothing at AAL1; staff cannot call either function (42501); the control is absent from their screens                                                                                                                                                                 | pgTAP suite 009; harness step 3c                       |
| Duplicate or replayed submission; a submitted answer edited                                       | One answer per request; the submission's idempotency key is stored, so the same key replays the same receipt and any other key is refused once submitted; a submitted answer, its citations, and its status are immutable by trigger, for every role                                                                                                                | pgTAP suite 009; harness step 3c; `useAnswer` tests    |
| Client-written text reaches a log, the trail, or an audit row                                     | The answer text lives on its protected row only; activity stays enumerated kinds; the audit receipt records lengths and counts, never the text; the screens never echo a server message                                                                                                                                                                             | pgTAP suite 009 (receipt shape); `AnswerView` tests    |
| A client, intake, or AAL1 staff moves a case, reads a package, a verdict, or an approval (WO-005) | The three workflow tables grant SELECT only, and their permissive policy admits staff of the row's own scope at AAL2 alone; every transition is a `security definer` function that re-derives the actor, requires AAL2 and the exact role membership in the exact scope, and refuses everything else as 42501                                                       | pgTAP suite 010; harness step 4b                       |
| The person who froze or reviewed a package approves it (WO-005)                                   | The server compares the actor with the package's `frozen_by` and its verdict rows and refuses (`conflict_of_interest`); the screen cannot know and does not need to                                                                                                                                                                                                 | pgTAP suite 010 (43, 64)                               |
| An approval that does not name what it approves; a stale approval that still authorizes (WO-005)  | The approval names the package id, its digest, the package number, the case version, the destination, and an expiry set by the server; a mismatch is refused; a new package or a reopened case supersedes an active approval; the sweep expires it                                                                                                                  | pgTAP suite 010 (65 to 78, 86 to 89); harness step 4b  |
| A recorded verdict, a frozen package, or an approval edited (WO-005)                              | Triggers refuse every update to a frozen package (except its supersession), a recorded verdict, and an ended approval, for every role including the owner                                                                                                                                                                                                           | pgTAP suite 010 (83 to 85)                             |
| A verdict's note reaches the trail or an audit row (WO-005)                                       | The note lives on the staff-only verdict row; activity stays enumerated; the audit receipt records the note's length and the verdict, never the note                                                                                                                                                                                                                | pgTAP suite 010 (56)                                   |
| Stale reservations; quarantine never empties                                                      | 24-hour transfer window, 30-day retention, an expiry sweep, and settled objects removed through the storage API                                                                                                                                                                                                                                                     | pgTAP suite 008; `quarantine-scan.mjs sweep`           |

## Controls in Milestone 0

- **Self-registration disabled**; email OTP with `shouldCreateUser: false`; TOTP MFA. AAL2 for staff is enforced twice: the controller routes staff to MFA before scope binding, and RLS enforces a **global staff gate** — a user holding any staff membership gets zero rows from every protected table (`environments`, `clients`, `entities`, `cases`, `case_attention_items`, `case_next_actions`) until the JWT carries `aal2`, even through a client-role membership and even by calling the Data API directly. The gate is implemented as **`AS RESTRICTIVE` policies**, separate from the permissive membership-scope policies: restrictive policies AND with whatever the permissive layer allows, so a later permissive allow policy cannot bypass the staff denial (pgTAP suite 006 proves the bypass regression by adding an allow-all policy in a transaction). **Precisely what AAL1 staff can see:** only their own rows in `public.memberships` — membership UUIDs, scope UUIDs, and role labels — which the client needs to route to MFA and the scope chooser. No client or workflow content, and not even scope _names_, is readable at AAL1 (names live in the gated tables). This own-membership exception is deliberate and test-locked (pgTAP suites 004/005/006 assert both the exact AAL1 visibility and the zero-row denials).
- **One Supabase client** behind an auth lifecycle controller with an acquisition freeze, auth epoch, and serialized refresh/sign-out/expiry.
- **Versioned SecureStore adapter**: serialized operations, generation-based two-phase commit for chunked sessions, SHA-256 digest verification, read-back verification of deletions, quarantine on any inconsistency. Keychain accessibility is `WHEN_UNLOCKED_THIS_DEVICE_ONLY` (no cross-device restore).
- **Install marker** outside the Keychain (app documents file, excluded from Android backup via `allowBackup=false`): Keychain material without a marker means reinstall → scrub before any auth construction.
- **RLS everywhere**: every exposed table has RLS enabled, per-operation least-privilege policies using membership subqueries, indexed policy columns, and pgTAP denial tests. Privileged functions live in an unexposed schema with fixed `search_path` and revoked PUBLIC execution.
- **No secrets in the app**: environment validation rejects secret-shaped keys in any variant, including JWT-form service-role keys (the payload role is decoded and only `anon` passes); a legacy anon key is loopback-development-only and release-rejected by `scripts/candidate-config-check.mjs`. The bundle inspector scans the binary Hermes bundles that actually ship (printable-string extraction), not just web text, and pins discovered publishable keys and Supabase endpoints to the approved configuration.
- **Data minimization**: no analytics/crash SDK; diagnostics interface is allowlist + redaction and its default sink is inert; no offline sensitive-write queue; TLS/ATS defaults preserved; Android cleartext stays denied (loopback development traffic is the emulator's own loopback).

## Controls added in Milestone 2 (WO-003)

- **The first client write, contained.** `document_uploads` is `SELECT`-only
  for clients and carries the Milestone 0 policy shape (permissive
  membership, restrictive staff-AAL2). Every write is one of two
  `security definer` functions in `public` — `begin_document_upload`
  (reserve) and `complete_document_upload` (verify and quarantine) —
  which re-derive the actor from `auth.uid()`, require a `client_user`
  membership in the exact scope triple the caller names, apply the
  staff-AAL2 rule to mixed-role users, lock the request row, and refuse
  a closed request, a stale version, a type outside the allowlist, an
  empty or oversize file, a malformed digest or name, and the eleventh
  document. Refusals are stable tokens (SQLSTATE `P0001`) the app words;
  authorization failures are `42501` exactly like a denied read.
- **A one-policy bucket.** `hive-quarantine` is private and bounded at
  the storage service (20 MB, four types). Its only policy admits an
  `INSERT` by the reserving user, at the reserved path, while the
  reservation is `UPLOADING` and inside its window, with the membership
  and AAL rules re-checked in the policy itself. Nothing grants read,
  list, update, or delete; the uploader cannot read their own object
  back.
- **A server-role scan interface.** `begin_document_scan`,
  `record_document_scan`, and `expire_stale_document_uploads` run as
  their caller (no borrowed authority) and are executable by
  `service_role` alone; a belt-and-brace check inside refuses any other
  role. No real scanner is approved (HOLD); the local lane's
  `HiveSyntheticScanner` recomputes size and digest and refuses a
  synthetic marker, and talks to the database only through this
  interface.
- **Memory-only on the phone.** The picked file's cache copy and its
  bytes exist for one attempt; the hook discards them on success,
  refusal, reset, and unmount, and an epoch drops late results. One
  idempotency key per checked document survives a transient failure so a
  retry cannot reserve twice.
- **The QA synthetic source, gated three ways** like every QA hook: the
  Metro stub outside QA builds, `bundle:inspect` proving the marker
  absent from non-development exports, `config:check` refusing the flag
  outside development.

## Controls added in Milestone 3 (WO-004)

- **The second client write, the same shape as the first.** `request_answers`
  and `request_answer_citations` are `SELECT`-only for clients and carry
  the Milestone 0 policy shape (permissive membership, restrictive
  staff-AAL2), with one difference stated in the permissive policy itself:
  a DRAFT is readable only through a `client_user` membership, so no
  staff role reads a draft at any AAL. Every write is one of two
  `security definer` functions in `public`, `save_request_answer_draft`
  and `submit_request_answer`, executable by `authenticated` and
  deciding inside who may act: the caller's `client_user` membership in
  the exact scope, the request in that scope, OPEN, at the version the
  screen read, the draft at the version the server last reported, the
  text within 4,000 printable characters, and every citation a document
  received on that request. Refusals are stable tokens the app words;
  authorization failures are `42501` like a denied read.
- **One explicit submission, once.** The submission stores its
  idempotency key on the answer; the same key replays the same receipt
  and any other key is refused once submitted. It moves exactly the
  request (to `ANSWERED`), appends one enumerated activity entry, and
  writes an audit receipt with lengths and counts, never the text. The
  case, its attention item, and its next action do not move: an answer is
  a HIVE record, not an accounting decision.
- **Immutable once submitted.** The lifecycle trigger refuses any update
  to a submitted answer and any change to its citations, for every role
  including the owner of the table; identity columns are immutable from
  insert.
- **A source link that cannot leave the scope.** `requests.subject_document_id`
  is a composite foreign key carrying the request's own scope, so a link
  to a document in another workspace is unrepresentable; the app resolves
  it by its own scoped read and renders nothing for a link it cannot
  resolve. Seeded only: no client or staff path sets one.
- **Memory-only on the phone.** The draft is server state; the phone
  holds the typed text for the screen and one submission key per
  confirmation, kept through a transient failure so a retry cannot
  submit twice, and dropped when the submission settles, is canceled, or
  the screen unmounts.

## Controls added in Milestone 4 (WO-005)

- **Staff-only workflow tables.** `case_review_packages`, `case_reviews`,
  and `case_approvals` are `SELECT`-only for `authenticated`, and their
  permissive policy admits only a staff membership (intake, preparer,
  reviewer, approver) in the row's own scope, under the global restrictive
  staff-AAL2 layer. A client user of the scope reads none of them; a
  staff member of another scope reads none of them; staff at AAL1 read
  nothing. Clients learn of the workflow through the case status and
  the enumerated trail alone.
- **Five reviewed transitions, one contract.** `freeze_case_package`,
  `start_case_review`, `record_case_verdict`, `resume_case`, and
  `approve_case_package` are `security definer` functions that take the
  exact scope, the case version the screen read, and an idempotency key;
  each re-derives the actor from `auth.uid()`, requires AAL2 and the role
  membership the step needs in the exact scope
  (`app_private.staff_member_for_scope`), locks the case, checks the
  status, the version, and the conflicts, moves exactly what the step
  moves, appends one enumerated trail entry, and writes one audit receipt
  whose details carry the key and the result, so the same actor's same
  key replays the same result and never moves the case twice.
- **The frozen package and its digest.** `app_private.build_case_manifest`
  renders the case's evidence as ids, statuses, versions, digests, and
  sizes (never a name or a text), sorted, and `manifest_digest` is
  SHA-256 over its canonical text; the package is immutable once frozen,
  and only the next package supersedes it.
- **Conflict of interest, decided by the server.** The reviewer must not
  be the package's freezer; the approver must be neither its freezer nor
  any of its reviewers. Proven with temporary memberships in pgTAP.
- **The approval's binding and life.** Every element the brief names is a
  column, immutable from insert: actor, role, scope, package id, number,
  and digest, case version, destination (`hive-record` only), and an
  expiry set by the server. Material change supersedes it (a new package,
  a reopened case); the server-role sweep expires it and returns the case
  to `APPROVAL_PENDING`.
- **The staff surface, gated by the server.** A staff Home row opens the
  case review; the screen offers only the role's action for the case
  status and confirms each one; a client reaching the route sees a
  staff-only notice and gets zero rows regardless. No control relies on
  the UI alone.
- **Lane tooling without borrowed authority.** The staging command signs
  the staff in for real (OTP through the test mailbox, TOTP enrollment)
  and calls the same transitions; the reset is the only privileged write,
  loopback-only and keyed to seeded cases.

## Controls added in Milestone 5 (WO-006)

- **The adapter interface is the server role's alone.**
  `record_ledger_reference` and `verify_filing_receipt` are executable by
  `service_role` only and re-check `app_private.require_server_role()`;
  the app has no path to either, a client or staff call is refused, and
  the harness proves it with real JWTs. The adapters are named on every
  row they touch (`adapter_name`); locally they are the synthetic
  `HiveSyntheticLedger` and `HiveSyntheticDrive`, production-inert, and
  a live adapter is HOLD until its own PASS.
- **Read-only toward the ledger and the record, by construction.** The
  ledger contract has no write; the record contract has no write, move,
  delete, or share. HIVE writes to neither: a filing is a person's act,
  recorded as a receipt; verification reads bytes and compares a digest.
- **A reference is never a value.** The `ledger_references` shape is
  identifiers, versions, a bounded printable label, an as-of time, and a
  digest; no column exists for an amount, a balance, or an account
  number (data classification: financial values excluded), and the rows
  are immutable (`ledger_reference_guard`).
- **A receipt binds to the approval it stands on.** `record_filing_receipt`
  is a `security definer` transition under the Milestone 4 contract
  (exact scope, case version, idempotency key, AAL2 role membership, one
  audit receipt): it requires an APPROVED case with an ACTIVE approval,
  a checked document in the approved package's manifest, a Drive file id
  in one shape and a bounded path, refuses a second receipt for the same
  document at the same file, records the document's checked digest as
  the claim, and moves nothing else. Verification settles a receipt once
  (`filing_receipt_lifecycle`), keeps what was found, and treats a
  missing object as a MISMATCH: a filing nobody can check is not verified
  by default.
- **Staff-only reads, again.** Both tables are `SELECT`-only for
  `authenticated`, permissive for staff of the row's scope, under the
  restrictive staff-AAL2 layer; a client reads zero rows and learns of
  the sources through the enumerated trail (`source.referenced`,
  `record.filed`, `record.verified`, `record.mismatch`). Audit details
  carry ids, statuses, and the adapter name; never a path, a label, or a
  digest of content.
- **Lane tooling without borrowed authority.** `stage-filing` signs intake
  in for real and calls the same transition; `sync-ledger` and
  `verify-filings` run the named synthetic adapters through the
  server-role interface, loopback only, the bearer in memory; the case
  reset removes receipts and references with the rest of the workflow.

## Controls added in Milestone 6 (WO-007)

- **The service kill switch preserves everything.** `set_service_state` is
  the server role's alone (run as the server role, never security
  definer), idempotent by key, appending every change to
  `service_status_changes`. While paused, a restrictive `*_service_open`
  policy on all seventeen protected tables returns zero rows for every
  command to every client role, and the two actor helpers every reviewed
  transition resolves through refuse first with `service_paused`. No row
  is removed or moved; pgTAP counts cases and audit receipts before and
  after. The status reaches the app through one public function with no
  user data; an unreadable status lets the app proceed because the server
  refuses on its own.
- **The deletion request is the person's, the completion is the server
  role's, and the records are the firm's.** `account_deletion_requests`
  admits own-row reads only and no direct write; the request and the
  withdrawal are `security definer` functions keyed to `auth.uid()`
  (staff at AAL2), idempotent, one open request per subject, with one
  audit receipt per scope held. Completion removes memberships and marks
  the request; the auth user is removed through the platform's admin API
  by the operator tooling; the request keeps a pseudonymous subject after
  the account is gone; the record tables' actor columns keep their uuids
  and no longer reference `auth.users`, so a deletion can never cascade
  into the business's records or fail because they exist.
- **Disclosures that cannot drift.** `privacy:reconcile` fails the build
  when a dependency looks like an analytics, crash, advertising, or
  tracking SDK, when a permission or usage description is declared that
  the disclosure does not name, when the iOS privacy manifest says
  anything other than the disclosure, when export compliance drifts, when
  a host is written into the app's code, or when the data classification
  stops excluding financial values.
- **A release configuration names real contacts or fails.**
  `config:check --profile release` requires the support address and the
  public deletion page and refuses reserved or testing domains for both.
- **Drills.** The backup drill restores a dump inside the container and
  compares twenty-one tables, the audit history among them; the deletion
  drill completes a request for the identity with no memberships and
  reads back that the account is gone and the record stands.

## Controls added for the review tenant (WO-008, option A)

- **The password grant is the server's to refuse.** GoTrue's
  password-verification hook (`app_private.review_password_verification`,
  runnable by GoTrue's role alone) rejects every password sign-in unless
  the user is the registered review identity and a review window is open;
  a wrong code is counted and ten close the window; every attempt writes
  an audit receipt in the review environment's scope. Email OTP and TOTP
  never pass through it. pgTAP pins its decisions and grants; the harness
  proves them against GoTrue's real password grant, including a seeded
  client refused with a valid password of its own.
- **One identity, one synthetic environment.** The review identity holds
  one client membership in a review environment seeded on demand; it
  reads exactly that environment's rows and nothing of any client.
- **The code never rests in the repository.** It lives in a file outside
  the repository, is set as the identity's password when a window opens,
  is replaced with an unknown value when the window closes and when the
  tenant is retired, and is passed to a device flow as a variable; no
  tool prints it.
- **The app's only change is one more refusal.** A code the server
  refused as an OTP is tried once as the review code; for anyone the
  server refuses, the OTP failure stands as it was.

## Deliberately not used (per brief)

Root/jailbreak detection, device attestation, certificate pinning,
obfuscation, and biometric local unlock are **not** substitutes for server
authorization and are excluded from Milestone 0. Any future adoption
requires a documented threat decision and recovery design.

## Residual risks (dispositioned)

| Risk                                                                                                                                                                                                                                                                                                     | Severity                                                                                                                                                                                                   | Disposition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `image-size` ≤ 2.0.2 DoS advisories (build-time Metro dependency; no fixed release published)                                                                                                                                                                                                            | Moderate (build-time only; no confidentiality impact; assets are repo-controlled)                                                                                                                          | Waivers recorded in `security/waivers.json` with `approvalStatus: proposed`, owner Kody; retest monthly, on every lockfile or Expo change, before any release candidate, and at expiry (2026-11-21). Compensating control: `audit:gate` rejects any tracked ICNS/JXL/HEIF/HEIC asset — by extension AND by file signature — while the matched advisories affect image-size. Until Kody ratifies the exact entries in writing, the audit and exception gates exit 3 (explicit HOLD); a proposed entry is never reported as approved                                                                                                                                                   |
| `uuid` < 11.1.1 bounds-check advisory via `xcode` (prebuild-time)                                                                                                                                                                                                                                        | Moderate, below the high gate                                                                                                                                                                              | Tracked for next dependency refresh                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| iOS same-device backup restore can restore both marker and this-device-only Keychain items together                                                                                                                                                                                                      | Low (same device, same owner; server AAL checks still apply)                                                                                                                                               | Documented; native-lane test when a device lane exists                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Hosted OTP email depends on BOTH template customization and a delivery path that reaches non-team recipients (Supabase June 3, 2026: new Free-tier default-provider projects cannot customize templates; the built-in default email service delivers only to project-team addresses and is rate-limited) | Release-blocking if unmet: sign-in emails would carry a link instead of the six-digit token the app requires, and authorized client/staff recipients outside the project team would receive nothing at all | Recorded release dependency (PRODUCT.md): hosted staging/release require a controlled custom SMTP provider OR an approved Send Email Hook — a paid plan alone is NOT sufficient — plus black-box proof against the hosted stack using an owned QA recipient that is not a project-team member: exactly one six-digit token, no magic link, sign-in completed by entering the code, and an unknown-email request yielding no account and no usable code. Met on STAGING 2026-09-29: Resend as custom SMTP on Honeybee's domain, the code template live, the four-step acceptance passed (evidence folder 2026-09-29-hosted-staging); the production project repeats it before release |
| Jest/component tests approximate native accessibility                                                                                                                                                                                                                                                    | Low                                                                                                                                                                                                        | Native accessibility QA is a device-lane gate before any release candidate                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| The review tenant's password-verification hook is a Teams/Enterprise feature of the hosted platform (learned 2026-09-29: the platform refuses any auth update that names it on a Free or Pro organization, even to keep it off)                                                                          | Release-blocking for option A as built if unmet: the hosted review sign-in cannot exist without the hook or the fallback                                                                                   | Open finding in the WO-008 plan with two ways forward for Kody (the plan that permits it, or the proposed fallback WO-009 in which the window tooling and a scheduled sweep govern the review password and the hook returns when the plan permits); staging keeps the hook off, holds no password, and has no review identity                                                                                                                                                                                                                                                                                                                                                        |

## Incident stop rules

On any suspected cross-scope disclosure, secret exposure, or storage-
quarantine escape: stop feature work, preserve evidence (do not rewrite
history), report to Kody with the exact reproduction, and do not represent
any affected capability as complete. Kill switches and rollbacks preserve
source records and audit history.

## OWASP MASVS mapping (current release target)

| MASVS family     | HIVE control                                                                                                   |
| ---------------- | -------------------------------------------------------------------------------------------------------------- |
| MASVS-STORAGE    | SecureStore adapter (digest, quarantine), install marker, no backup of auth material, no sensitive local cache |
| MASVS-CRYPTO     | Platform keystore via SecureStore; no home-rolled crypto for secrets (local SHA-256 is integrity-only)         |
| MASVS-AUTH       | Invite-only OTP, TOTP MFA, AAL2 for staff, server-side membership, auth epoch, serialized lifecycle            |
| MASVS-NETWORK    | TLS only (loopback dev exception), ATS defaults, no cleartext on Android                                       |
| MASVS-PLATFORM   | Expo managed CNG, minimal permissions (none added), predictive back, no exported surfaces                      |
| MASVS-CODE       | Strict TS, lint gate, pinned toolchain, dependency review rule, secret gate                                    |
| MASVS-RESILIENCE | Deliberately deferred (see above) with documented rationale                                                    |
| MASVS-PRIVACY    | Data classification allowlist, diagnostics redaction, synthetic data only, no analytics SDK                    |
