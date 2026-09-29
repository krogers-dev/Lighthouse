# Work Order 009 — The review tenant without the hook (fallback)

**Status: built 2026-09-29 on Kody's desktop at his written instruction
("Go with the fallback, build it now"), after his choice of the same day
("your recommended fallback") recorded in the WO-008 plan's open finding.
Every decision is provisional and recorded in `security/APPROVALS.md` for
his one-line ratification. Nothing here touches a HOLD item: the hosted
projects receive one migration each, as every migration before it.**

**Owner:** Kody (acceptance, security). **Wording:** Stacie.

## 1. Why

The hosted platform offers GoTrue's password-verification hook, which
WO-008 built the review sign-in on, only on its Teams and Enterprise
plans. Below them the hook never runs, and the platform refuses even to be
told about it (HTTP 402 on every auth update that names it). Honeybee's
organization is on the Free plan and the Teams price is out of proportion
to one review identity in a synthetic environment. The review sign-in
must therefore hold by other means, on every plan, with the hook kept
for the day a plan permits it.

## 2. Outcome

The same three rules as WO-008, enforced without the hook:

1. **Nobody but the review identity, and only inside an open window,
   holds a usable password.** A trigger on `auth.users` replaces any
   other password hash the moment it is written, whoever writes it: a
   client setting a password on their own account, an operator, anyone.
   It never raises; it only replaces.
2. **A window ends at its close time even when nobody closes it.** A
   scheduled sweep (pg_cron, every minute, where the extension exists)
   closes expired windows, replaces the review identity's hash, and
   revokes its sessions; it also scrubs any stray hash, once, and records
   what it did.
3. **Closing a window, and retiring the identity, end access on the
   server**: the hash replaced and every session revoked, not only the
   tooling's Auth Admin call.

What the hook gave and this cannot: counting wrong codes and closing the
window after ten. GoTrue's sign-in rate limit (thirty attempts per five
minutes per address), the code's twelve to twenty digits, and the
window's own close time stand in.

## 3. Requirements

- R1. `guard_password_hash` (before update of `encrypted_password` on
  `auth.users`, security definer): a changed, non-empty hash for anyone
  who is not the review identity inside an open window becomes a hash of
  random bytes.
- R2. `app_private.review_window_sweep(as_of)`: closes open windows whose
  close time has passed as of that moment (`close_reason = 'expired'`),
  ends the identity's access, writes `review.window_closed` with reason
  `expired`; then scrubs every hash that is not the review identity's
  inside an open window and is not the recorded scrambled one; records
  counts in `review_sweep_state` and per user in `password_scrubs`.
- R3. `public.review_sweep(as_of)`: the server role's entry, refusing a
  moment more than a minute in the past.
- R4. `close_review_window` and `unregister_review_identity` call
  `end_review_access` (hash replaced, sessions deleted, refresh tokens
  with them) and write the close reason.
- R5. `review_window_status` carries the sweep state and the scrub count.
- R6. The schedule: `hive-review-window-sweep`, every minute, created by
  the migration where pg_cron exists; a notice where it does not (the
  plain-PostgreSQL lane), where the tooling runs the sweep by hand.
- R7. The local stack runs with the hook off by default, as the hosted
  projects do; `HIVE_REVIEW_HOOK=on` tells the harness to expect the
  hook's counting when someone switches it on to prove the hook.
- R8. Tooling: `sweep-review-window`; `open` sets the code after opening
  the window (the only order the trigger allows); `close` and `status`
  report the server's work.

## 4. Threats and how they are met

| Threat                                                                          | Met by                                                                                                                                          |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| T1. A client sets a password on their own account and bypasses the emailed code | R1: the hash is replaced as it is written; pgTAP 014 (6, 9); the harness's owner negative                                                       |
| T2. A window nobody closed leaves the review code valid                         | R2/R6: expired within a minute, access ended; pgTAP 014 (19–23); the harness's sweep step                                                       |
| T3. A session issued inside a window outlives it                                | R2/R4: sessions revoked at close, expiry, and retirement; pgTAP 014 (13, 22); the harness's refresh negatives                                   |
| T4. Wrong codes are not counted without the hook                                | Accepted and recorded: the rate limit, the code length, the window's close time; the harness asserts the zero count in fallback mode            |
| T5. A trigger on an auth table breaks GoTrue's own writes                       | The trigger fires only on `encrypted_password` changes, never raises, only replaces; the acceptance and the device flow prove GoTrue unaffected |
| T6. The sweep scrambles an ordinary user's hash mid-session                     | Ordinary users have no password by design; the scrub never touches sessions; pgTAP 014 (24) shows it converges                                  |
| T7. The server role runs the sweep as of a far past moment to reopen history    | R3 refuses more than a minute in the past; a future moment only ends windows sooner, which the server role may do anyway                        |

## 5. Decisions recorded (provisional, Kody's to ratify)

| Decision                            | As built                                                                                                             |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| The hook off locally by default     | The local stack mirrors the hosted projects; the hook's proof is a documented switch                                 |
| Every minute                        | The sweep's schedule; the exposure after a missed close is at most a minute plus the window's own close time         |
| The trigger replaces, never refuses | A refusal would surface as a server error to GoTrue; a replacement leaves every flow intact and the password useless |
| Scrub records                       | `password_scrubs` keeps a digest per user so the sweep converges; `review_sweep_state` keeps counts for the status   |
| `as_of`                             | The server role may sweep as of a later moment (ending windows sooner), never as of the past                         |
| Retirement revokes                  | `unregister_review_identity` ends access on the server, so retirement never depends on the tooling's second call     |

## 6. Proof

- pgTAP `014_review_tenant_fallback.test.sql`: 24 assertions (grants, the
  trigger, the three rules, the schedule, convergence). Suite 013 unchanged.
- The harness (`local-supabase.mjs e2e`, step 4e): the code useless
  without a window, set after opening, a wrong code refused and not
  counted in fallback mode, sign-in and exact reach, the owner negative,
  the sweep as of two hours on expiring the window with the code and the
  session, a second window closed on request with the same effect, both
  close reasons on the trail, retirement.
- The live bridge test and the device flow (`review-sign-in.yaml`)
  unchanged: the reviewer's experience is the same.
- The hosted projects: the migration pushed to staging and production,
  the schedule present on both.

## 7. Execution record

Runs of 2026-09-29 on Kody's desktop (evidence:
`security/evidence/2026-09-29-desktop-wo-009/`):

| Proof                                  | Result                                                                                                                |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| pgTAP (`supabase test db`, hook off)   | 14 files, 511 assertions, PASS; suite 014 the 24 new ones                                                             |
| The harness (`local-supabase.mjs e2e`) | 400 checks, 0 failed; step 4e in fallback mode, every line in the evidence folder                                     |
| The bridge (live app-level tests)      | 7 suites, 13 tests, the reviewer's sign-in through the shipped composition among them                                 |
| The device (`review-sign-in.yaml`)     | PASS on Pixel_8: the code on the ordinary screens, only the review workspace visible; window closed, tenant retired   |
| Hosted                                 | the migration on staging and production; the schedule active and run once on each; the trigger present on each        |
| Gates                                  | typecheck, lint, format, script tests, types check, toolchain, privacy, maestro:validate, config:check, audit gate OK |

One correction during the build: the migration first tried to find the
close-reason constraint by its definition text and matched nothing (the
catalog renders the list as `= ANY (ARRAY…)`), so the add collided; it
now drops the constraint by its deterministic name.
