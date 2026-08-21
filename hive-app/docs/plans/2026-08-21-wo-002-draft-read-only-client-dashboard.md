# DRAFT, NOT AUTHORIZED TO EXECUTE

# Work Order 002 (draft) — Milestone 1: Read-only client dashboard

**Status: DRAFT, NOT AUTHORIZED TO EXECUTE.** Drafting was authorized by
the Project Manager directive of 2026-08-21; implementation is forbidden
until (a) the repository split into a dedicated HIVE repository is complete
and re-verified, and (b) Milestone 0 is PASS. This document refines
requirements, threats, acceptance tests, dependencies, and rollout
controls only. It adds no Milestone 1 code, no migrations, no live data,
no production credentials, and no release configuration. A later written
version supersedes this one.

**Owner:** Kody (acceptance); Stacie (client-experience language).
**Scheduling:** HOLD until Kody or Stacie supplies dates.

## 1. Outcome

An authorized client user sees, inside one selected scope, a truthful
read-only working view: current case status with source timestamps, the
list of open requests addressed to them, a bounded activity trail, help
content, and account information. Staff users see the same read surface
gated at AAL2. Nothing is writable from the mobile app in this milestone
except session/scope actions that already exist; there are still no
uploads, no financial values, no QBO/Drive content, and no notifications.

Explicitly excluded (per PRODUCT.md roadmap): uploads (Milestone 2),
client answers/submission (Milestone 3), approvals (Milestone 4), source
adapters (Milestone 5), store release (Milestone 6).

## 2. Requirements (draft)

### Functional

- R1. Home shows the selected scope's case: status, status-changed
  timestamp labeled as server time, the single most important attention
  item, and the owned next action — extending the Milestone 0 dashboard
  from one synthetic case to the scope's real (still synthetic-data) case
  list, newest first, with explicit empty state.
- R2. Requests: a read-only list of open requests for the selected scope
  (title, what is needed, who owns it, requested date, due date if any,
  status), plus a read-only request detail screen. No respond/upload
  controls exist in the binary.
- R3. Activity: a bounded, append-only view of workflow events for the
  scope (status changes, request creation/closure), each with server
  timestamp and acting role label — never a personal name in Milestone 1.
- R4. Help: static, versioned help content shipped with the app (no
  remote CMS), including how to reach Honeybee Accounting.
- R5. Account: existing Milestone 0 surface (scope switch, sign-out,
  access summary) unchanged.
- R6. Every list read is bound to the full ScopeKey (environment, client,
  entity, membership) and cancels/discards across scope or membership
  switches exactly like the Milestone 0 dashboard (P2-9 contract).
- R7. Staleness is visible: each screen shows source-of-truth timestamps
  ("as of" server time), and a reload affordance; no background polling.

### Non-functional

- N1. All Milestone 0 security invariants continue unchanged (RLS
  everywhere, global staff AAL2 gate, no secrets in the app, synthetic
  data only, no analytics).
- N2. Explicit states on every new screen: loading, empty, offline,
  denied, stale-scope, error, quarantine (inherited globally).
- N3. WCAG 2.2 AA on every new screen (targets, labels, 200% text,
  light/dark, reduced motion) with the same measured-contrast token rules
  (Brand Kit v2.0).
- N4. No new dependencies without the ADR dependency rule; expected: none.

## 3. Threat deltas (draft)

The Milestone 0 threat model (SECURITY.md) stays authoritative. New or
widened surfaces in Milestone 1:

- T1. **Wider read surface, same boundary.** Requests and activity add two
  protected tables/views. Threat: policy drift between tables. Control:
  the same membership + global-staff-AAL2 policy shape, factored as one
  reviewed SQL macro/pattern; pgTAP denial suites extended per table
  (anonymous, no-membership, wrong-client, wrong-entity, forged id,
  cross-scope staff, mixed-role AAL1).
- T2. **Enumeration through list endpoints.** Threat: guessing ids across
  scopes via list filters. Control: RLS filters rows before any predicate
  the client supplies; pgTAP proves a filter on a foreign scope returns
  zero rows, not an error that confirms existence.
- T3. **Activity as an information leak.** Threat: event rows leaking
  excluded fields (names, filenames, financial values) into a read
  surface, logs, or screenshots. Control: activity rows carry only
  enumerated event kinds, role labels, and timestamps; the data-
  classification allowlist gains the activity event shape and a test that
  serializing an event contains no non-allowlisted key.
- T4. **Stale-as-current misrepresentation.** Threat: cached list content
  presented as live. Control: no persistent response cache exists (M0
  rule retained); "as of" timestamps come from server time in the
  response, and the offline state replaces content rather than aging it.
- T5. **Request detail deep links.** Threat: a request id arriving via
  deep link crossing scope. Control: route params never become scope
  (existing rule); detail reads re-verify membership server-side and the
  screen falls to denied on zero rows.

## 4. Acceptance tests (draft)

- A1. pgTAP: every new table/view has RLS enabled, per-operation
  policies, indexed policy columns, and the full negative matrix
  (extending suites 001–005), including mixed-role AAL1 zero-row proofs.
- A2. Contract tests: request and activity repositories require a
  ScopeKey; late responses across scope AND membership switches never
  render (extends the P2-9 test); denied/offline/empty/error states
  render for each screen.
- A3. Black-box e2e (local stack): with two seeded clients, a client user
  sees exactly their scope's requests/activity through PostgREST and the
  app; a staff user at AAL1 sees zero protected rows; at AAL2 exact
  reach; unknown request ids return zero rows (no existence signal).
- A4. Accessibility: jest checks for labels/roles/targets on every new
  screen; measured contrast unchanged; device-lane screen-reader QA per
  the Screenshot QA matrix.
- A5. Maestro: requests list/detail, activity, help, offline, and
  denied-after-revocation flows (device lane).
- A6. All Milestone 0 gates re-run green at the WO-002 candidate commit
  in the new repository (secret scan, audit gate, config check, bundle
  inspect, export, clean-checkout drill).

## 5. Dependencies (draft)

- D1. Repository split to the dedicated HIVE repo completed, digests
  verified, gates re-run in the new root (PM directive §4) — **blocking**.
- D2. Milestone 0 PASS at the corrected candidate (including the pinned
  Supabase-stack evidence and device-lane evidence, owner Kody) —
  **blocking**.
- D3. Schema deltas (requests, activity events) designed against the
  existing composite-FK scope pattern — design doc first, migrations only
  inside WO-002 execution, never in this draft.
- D4. Content: request/activity/help wording owned by Stacie (relationship
  language); synthetic fixtures updated in lockstep across
  `scripts/lib/synthetic-identities.mjs`, `supabase/seed.sql`, and pgTAP
  seeds.
- D5. No new runtime dependencies anticipated; any exception goes through
  the ADR 0001 dependency rule before use.

## 6. Rollout controls (draft)

- C1. Same checkpoint discipline: small vertical slices, one coherent
  commit per checkpoint, PASS/RETURN/HOLD at each gate, red-green for
  every authorization or transition behavior.
- C2. No live data at any point in Milestone 1; synthetic `example.invalid`
  identities only; production integrations remain HOLD.
- C3. No client-visible write controls ship disabled or hidden — absent
  means absent from the binary (V1 surface rule).
- C4. Kill-switch/rollback posture unchanged: development builds only,
  no store lanes, no OTA; the milestone ends at a device-verified
  read-only candidate, not a release.
- C5. Evidence: the WO-002 report carries exact commands, exit codes,
  versions, and counts, with sanitized artifacts, mirroring the WO-001
  acceptance format.

— End of draft. Not authorized to execute. —
