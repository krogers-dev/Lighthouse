# WO-011 — the hosted operator mode — 2026-09-30

Executed on Kody's Windows desktop from a local Claude session, at the
tree committed with this record, as the next task named in that morning's
report, under his standing instruction and his general grant. Staging was
changed and left retired. **Production was only read.** The project's
secret key was read from the Supabase CLI under Kody's login for each
command, held in memory, and written nowhere; the database password came
from his approvals folder into a process environment. This folder was
scanned for both passwords (raw and percent-encoded), every key shape,
and any run of twelve to twenty digits: none.

| Step | Command                                                                                                       | Result                                                                                                                                                                                                             |
| ---- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1    | `node --test tests/scripts/hosted-operator.test.mjs`                                                          | ✅ 37 tests: the manifest, targets and origins, the confirmation rule, keys and redaction, both lanes of the context, the code file, the switch, and every refusal as a process that reaches no network            |
| 2    | `hosted-supabase.mjs staging review-window-status`, `production review-window-status`                         | ✅ both closed, no review identity; the sweep running each minute on both                                                                                                                                          |
| 3    | `hosted-supabase.mjs staging prove-review`                                                                    | ✅ **33 checks, 0 failed** — `prove-review-staging.log`                                                                                                                                                            |
| 4    | staging read as the database owner                                                                            | ✅ the identity retired, no session, no membership, no usable password anywhere, nothing left of the proof's second identity — `staging-state-after-proof.log`                                                     |
| 5    | pgTAP on staging with the review tenant present                                                               | ❌ then ✅: five assertions depended on a database that had never held it (`pgtap-staging-before-suite-fix.log`); the suites now count in their own scope; **14 files, 511 assertions, PASS** — `pgtap-staging.log` |
| 6    | `staging seed-review`, `open-review-window 1`, `check-review-sign-in`, `close-review-window`, the check again | ✅ the real sixteen-digit code, generated into the approvals folder and never shown, signs in and sees exactly the review workspace; after the close the same check is refused (400) — `operator-review-staging.log` |
| 7    | `staging sweep-review-window`, `retire-review`, `review-window-status`                                        | ✅ retired; closed, no review identity                                                                                                                                                                             |
| 8    | `staging service-status`, `pause-service maintenance`, the app's own read, `resume-service`                   | ✅ open, paused (the publishable key reads "paused"), open — `operator-kill-switch.log`                                                                                                                            |
| 9    | `production service-status`; `production pause-service incident` without the ref                              | ✅ open, version 1, untouched; the change refused before any key was read                                                                                                                                          |
| 10   | production read as the database owner                                                                         | ✅ 0 users, 0 sessions, 0 environments, 0 memberships, 0 windows, 0 receipts — `production-state.log`                                                                                                              |
| 11   | local: `db reset`, `seed`, the switch used, `seed-review`, a window open, then `supabase test db`             | ✅ 14 files, 511 assertions, PASS with all of that present — `pgtap-local.log`                                                                                                                                     |
| 12   | local: `local-supabase.mjs e2e`, then `bridge`                                                                | ✅ 400 checks, 0 failed (`harness-review-tenant.log`); 7 suites, 13 tests                                                                                                                                          |
| 13   | lint, format, typecheck, script tests, jest, types check, toolchain, privacy, flows, config, audit, eas:guard | ✅ all exit 0; script tests 451 (415 passed, 36 skipped by platform); jest 733; `config:check --profile release` OK with the four release values                                                                   |

## What this proves

- An operator can seed the review tenant, open and close a window, check
  that the code opens the door, retire the tenant, and pause and resume
  the service on a hosted project, from this desktop, without the key
  ever resting anywhere.
- The reviewer's sign-in holds on the hosted platform as it does locally:
  refused without a window, admitted with the code inside one, reading
  one environment, one case, and two requests on a project that holds
  four other cases, refused after expiry, after a close, and after
  retirement, with the sessions ended each time.
- A change on production cannot happen by a slip of the target name: it
  needs the project ref repeated, and the proof cannot run there at all.
- The database suites pass on a project that carries the review tenant
  and whose switch has been used.

## What this does not prove

- Anything on production beyond two reads: the review tenant is seeded
  there at Kody's word.
- The reviewer's flow on a device against a hosted project: the app
  emails a code to the review address when it is typed, so that waits for
  `review@myhbcfo.com` to exist.
- Counting of wrong codes: the hook did that; without it the rate limit,
  the code's length, and the window's close time bound the exposure.
- That reads return zero rows on staging while paused, through a signed-in
  client: suite 012 proves it in the database, and it passes there.

## Left on staging

The review environment's rows, the review identity `review@myhbcfo.com`
with no membership and not registered, three closed windows and their
receipts, a service status at version 3, open. In Kody's approvals
folder: `review-code-staging.txt`, the code of the rehearsal window, set
on nothing now; deleting it rotates the code at the next open.
