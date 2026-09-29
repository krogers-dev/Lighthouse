# Work Order 008 — The store review tenant (Milestone 6, option A)

**Status: executed 2026-09-29 on Kody's desktop, on Kody's written
decision the same day ("Go with review-tenant option A"), under his
standing instruction of 2026-09-18 ("just RUN").** The sub-decisions
option A left open (hosting, custody of the code, the window rule) are
recorded as provisional in `security/APPROVALS.md`. Nothing here touches a
store, a hosted project, or live data: the mechanism exists and is proven
on the local synthetic stack, and its hosted configuration is a named
HOLD row.

**Owner:** Kody (the decision, the code's custody, the hosted hook).
**Wording:** none new for clients; the reviewer notes are in
`docs/release/store-listing.md`.

## 1. Outcome

App Review can sign in without a mailbox or an authenticator. One review
identity, a client user of a dedicated synthetic review environment,
signs in on the ordinary screens with the review email and the review
code; the server admits exactly that identity, only while a review
window is open, and refuses everyone else the password grant, always.
Every attempt is on the audit trail. The code lives in a file outside the
repository, is set when a window opens and replaced with an unknown
value when it closes, and is never printed. The staff surface is shown to
reviewers by video, so no authenticator exception exists.

Explicitly excluded: any change to email OTP or TOTP for anyone; a
password for any identity but the review identity; the hosted hook
configuration, the hosted review mailbox, and the review notes themselves
(HOLD until the store accounts exist).

## 2. Requirements

- R1. GoTrue's password-verification hook, in Postgres
  (`app_private.review_password_verification`), decides every password
  sign-in attempt: reject unless the user is the registered review
  identity and a window is open; on a wrong code, count it and close the
  window after ten; write one audit receipt per attempt in the review
  environment's scope.
- R2. `app_private.review_identities` and `app_private.review_windows`,
  reachable by GoTrue's role and the server role only; `register_review_identity`,
  `unregister_review_identity`, `open_review_window` (one to 168 hours,
  one open at a time, replay by key), `close_review_window` (replay by
  key), and `review_window_status`, all server role only.
- R3. The app tries a code the server refused as an OTP once as the
  review code (the password grant), and only then; the OTP failure stands
  for anyone the server refuses. Nothing else in the app changes.
- R4. The review tenant is seeded on demand (`seed-review`), never by
  the main seed; `retire-review` closes any window, replaces the code,
  unregisters the identity, and removes its membership.
- R5. `open-review-window [hours]` reads or creates the code in the file
  `HIVE_REVIEW_CODE_FILE` names, outside the repository, and sets it;
  `close-review-window` replaces it. Neither prints it.
- R6. Proofs: pgTAP 013, harness step 4e, the live bridge's review-tenant
  suite, and the device flow `review-sign-in.yaml`.

## 3. Threat deltas

- T-RT-1 **The review code opens any account.** The hook rejects every
  identity but the registered one; pgTAP and the harness prove a seeded
  client with a valid password of its own is refused.
- T-RT-2 **The code works outside a window.** Refused by the hook; the
  code is also replaced with an unknown value at close and at retirement.
- T-RT-3 **The code is guessed.** Twelve to twenty digits (sixteen when generated), because it is typed where the sign-in code is typed; generated
  from random digits by default; ten wrong attempts close the
  window; GoTrue's own rate limits apply; every attempt is audited.
- T-RT-4 **The code leaks through the repository or the logs.** It lives
  in a file outside the repository, is passed to Maestro as a variable,
  and no tool prints it; the lane's own file is temporary and removed.
- T-RT-5 **The review identity sees a real client.** It holds one
  membership, in the synthetic review environment; the harness proves it
  reads exactly the review environment's rows.
- T-RT-6 **A hook bug breaks sign-in for everyone.** The hook runs only
  for the password grant; OTP and TOTP never reach it; pgTAP pins its
  decisions and its grants.

## 4. Acceptance tests

- pgTAP `013_review_tenant.test.sql` (30): grants; registration and its
  refusal; the hook without a window, with a stranger, with a malformed
  event; a window's validation, replay, and exclusivity; the hook inside
  the window for the identity and for anyone else; failures counted and
  the window exhausted; closing with replay.
- Harness step 4e (`scripts/lib/review-tenant-path.mjs`): the whole
  lifecycle against GoTrue's real password grant, the JWT's subject, the
  exact reach, the negatives, the trail, and retirement.
- Live bridge `review-tenant-live.test.ts`: the shipped composition's
  sign-in with the code from the lane's file, the review workspace, the
  one case.
- jest `controller.test.ts`: the refused code is tried once as the review
  code; only a session the server returns is admitted.
- Maestro `review-sign-in.yaml`.

## 5. Decisions made under the standing instruction (provisional)

Recorded in `security/APPROVALS.md` under "Review tenant (WO-008)":
hosting alongside staging; custody of the code file with Kody; windows
of at most a week, one at a time, ten failures closing one; the identity
as a client user only; the staff surface by video; retirement after each
window.

## 6. Dependencies and rollout controls

- C1. On a hosted project the hook is enabled in the project's auth
  configuration exactly as `supabase/config.toml` enables it here; that
  step is in the signing-and-submission checklist.
- C2. The review identity's hosted email is an address Honeybee controls
  (its OTP emails are never read, but they must not bounce elsewhere).
- C3. The review notes name the review email and the code for the
  window the submission opens; the window closes when the review ends.
- D1. Kody: the hosted project's hook, the custody file's location, and
  the review window for each submission.

**Open finding (2026-09-29, from the hosted staging setup).** The
password-verification hook is a **Teams/Enterprise** feature of the hosted
platform (the vendor's hook table; the platform answered HTTP 402 "cannot
be configured for this organization" to every auth update that named it,
even with `enabled = false`). C1 therefore cannot be met on the Free or
Pro plan. Two ways forward, Kody's decision:

1. **The plan that permits the hook**: option A exactly as built and
   proven, at the Teams plan's price.
2. **The fallback (proposed WO-009)**: the window tooling alone gives the
   review identity its code as a password on `open-review-window` and
   scrambles it on `close-review-window` (both exist today); a scheduled
   sweep in Postgres scrambles the hash the moment a window's `expires_at`
   passes, so an unclosed window still ends; GoTrue's sign-in rate limit
   (30 attempts per five minutes per address) and the code's twelve to
   twenty digits replace the hook's ten-failure close; the hook function,
   its tables, and pgTAP 013 stay, and the hook is switched on the day the
   plan permits it. What the fallback loses: the per-attempt audit receipt
   and the hard "only this identity may hold a password" refusal (nothing
   else holds a password by design, and the Auth Admin API is
   server-side only).

The recommendation is 2, because the Teams price is out of proportion to
one review identity in a synthetic environment, and because the fallback
keeps every proven part. Until Kody decides, the hook is off on staging,
no review identity exists there, and `seed-review` stays local.

## 7. Execution record

See "WO-008 execution record" below, written as the lanes ran.

## WO-008 execution record — 2026-09-29, Kody's desktop

Built in the same local session as Milestones 2 to 6, from the Milestone
6 ratification record (`2d99849`), on the same Docker stack (Supabase CLI
2.115.0, restarted once to enable the auth hook), emulator `Pixel_8` (API
35), Maestro 2.10.0, Node 22.23.2, the Milestone 2 QA build reused
unchanged, Metro restarted for the one app change.

### Checkpoint 1 — the server

Migration `20260929120013_review_tenant.sql`: the two `app_private`
tables, GoTrue's password-verification hook, the registration, window,
and status functions for the server role, and their grants (GoTrue's
role reads the identities and updates the windows; the server role
holds the tables it writes). `supabase/config.toml` enables the hook.
pgTAP `013` (30) proves the grants, the registration and its refusal,
the hook without a window and with a stranger, a window's validation,
replay, and exclusivity, the hook's decisions inside the window, the
failure count and the exhausted window, and closing with replay.

### Checkpoint 2 — the app, the tooling, the proofs

`AuthController.submitOtp` tries a code the server refused as an OTP
once as the review code; `AuthGateway.signInWithPassword` is the one
new gateway call; the controller suite pins both. `seed-review`,
`retire-review`, `open-review-window`, `close-review-window`, and
`review-window-status`; harness step 9 (the review tenant's whole
lifecycle against GoTrue's real password grant, run last); the bridge
lane's review prelude and the `review-tenant-live` suite; Maestro
`review-sign-in.yaml` (25 flows); the records in
`security/APPROVALS.md`, `SECURITY.md`, `PRODUCT.md`,
`docs/data-classification.md`, the README runbook, the checklist's step
10, `docs/release/review-tenant.md`, and `.maestro/README.md`.

### Finds this execution produced

- **Find 70 — the server role could not write its own tables.** The
  registration and window functions run as the caller, and the server
  role held no privilege on the `app_private` tables; pgTAP caught it on
  the first run. Grants added.
- **Find 71 — a password set and replaced on a seeded identity
  invalidates its refresh token.** The harness's negative (a seeded
  client with a valid password of its own is still refused) broke that
  client's later refresh exchange. The review-tenant step now runs last,
  after every session the earlier steps still exchange.
- **Find 72 — the live suites cannot read files.** The app's TypeScript
  configuration has no Node types, so the lane hands the review code to
  the suites in memory (`HIVE_REVIEW_CODE`) instead of a file path.

### The device run

`security/evidence/2026-09-29-desktop-review-tenant/`: the review
identity typed its email and the sixteen-digit lane code on the ordinary
screens and landed in the review workspace with the review case and
nothing of any other client; the window closed with zero failed
attempts, the tenant was retired, and the code appears in no log. Two
earlier attempts produced finds 73 and 74 and are recorded there.

### Gates at the candidate, all fresh

| Gate                                                    | Result                                                                        |
| ------------------------------------------------------- | ----------------------------------------------------------------------------- |
| typecheck                                               | exit 0                                                                        |
| eslint, max-warnings 0                                  | exit 0                                                                        |
| prettier, check                                         | exit 0                                                                        |
| verify:toolchain                                        | OK                                                                            |
| jest                                                    | **733 passed across 62 suites**                                               |
| test:scripts (node:test)                                | **373 passed, 0 failed, 36 skipped** (device-lane tests)                      |
| pgTAP, CLI stack (`supabase test db`)                   | **13 files, 487 asserts, PASS** (suite 013: 30)                               |
| black-box harness, CLI stack (`local-supabase.mjs e2e`) | **391 passed, 0 failed** on a fresh seed (the review tenant's lifecycle last) |
| live bridge, CLI stack (`local-supabase.mjs bridge`)    | **13 passed across 7 suites** (the review-tenant suite among them)            |
| maestro:validate                                        | OK — 25 flows, 5 helper scripts                                               |
| db:types:check                                          | committed types match the schema                                              |
| config:check (development)                              | OK                                                                            |
| eas:guard                                               | OK — still the one simulator profile, no submit lane                          |
| privacy:reconcile                                       | OK                                                                            |
| audit:gate                                              | OK — moderate advisories below the gate, no waiver on file                    |
| secrets:scan, with Kody's ratification record           | OK                                                                            |
| export:candidate (inspects its own output)              | OK — synthetic candidate lane                                                 |
| Maestro on `Pixel_8`                                    | `review-sign-in.yaml` OK with the lane code (evidence folder above)           |

### State

The review tenant exists and is proven end to end on the local
synthetic stack, under Kody's option A; its provisional sub-decisions
(custody, the window rule, hosting) are listed in
`security/APPROVALS.md` for one line from Kody. The hosted steps stay
HOLD rows in the signing-and-submission checklist: enabling the same
hook on the hosted project, a controlled mailbox for the review
identity, and a window and its notes per submission. Committed on
`claude/hive-fable-5-greenfield-p0cwkq`.
