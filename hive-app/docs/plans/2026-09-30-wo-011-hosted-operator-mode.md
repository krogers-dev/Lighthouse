# Work Order 011 — The hosted operator mode (review tooling and the kill switch)

**Status: built and proven 2026-09-30 on Kody's desktop, as the next task
named in the report of the same morning ("build that hosted operator mode
for the review tooling, with the project's secret key held in memory only,
proven on staging first"), under his standing instruction to run and his
general grant. Proven on staging. Production was only read: it holds no
user and no row, and the review tenant is seeded there at Kody's word,
not before. Every decision is provisional in `security/APPROVALS.md`.**

**Owner:** Kody (acceptance, security, custody). **Wording:** Stacie.

## 1. Why

The store reviews the build that is submitted, and that build talks to
the production project. So the review tenant of WO-008 and WO-009 has to
exist on production before a submission, with a window opened for it.
The seed and window tooling was loopback-only by design, and so was the
kill switch, whose hosted use the rollback runbook had left as a HOLD
("who may run them, and from where"). Until an operator can run these
against a hosted project, safely, there is no review account to give a
store and no way to pause production.

## 2. Outcome

One runner, `scripts/hosted-supabase.mjs` (`npm run supabase:hosted --`),
the counterpart of `local-supabase.mjs`:

| Command                                 | What it does on the named project                                                                                | Kind   |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------ |
| `review-window-status`                  | open or closed, the close time, the sweep's last run, how many review identities                                 | read   |
| `seed-review`                           | the synthetic review environment, the review identity on Honeybee's review mailbox, its membership, registration | change |
| `open-review-window [hours]`            | opens the window, then sets the code from the target's code file (generated if absent, never printed)            | change |
| `check-review-sign-in`                  | signs in with the code in the file as the app does, reads what the session sees, signs out                       | change |
| `close-review-window`                   | closes the window: the code replaced, the sessions revoked                                                       | change |
| `sweep-review-window`                   | the scheduled sweep, by hand                                                                                     | change |
| `retire-review`                         | ends all access: window closed, code replaced, identity unregistered, membership removed                         | change |
| `prove-review` (staging only)           | the black-box path of the local harness against the hosted project                                               | proof  |
| `service-status`                        | the kill switch's state                                                                                          | read   |
| `pause-service [maintenance\|incident]` | pauses the service: every read returns zero rows, every transition is refused, nothing is removed                | change |
| `resume-service`                        | resumes it                                                                                                       | change |

## 3. Requirements

- R1. **Two targets and no others.** `security/hosted-targets.json` lists
  staging and production by project ref, origin, and review address. The
  runner and each tool compare the origin exactly after parsing; any
  other host is refused. The manifest must agree with
  `supabase/config.toml` and the release profile of
  `security/approved-config.json`, and may hold nothing key-shaped.
- R2. **The key is never stored.** The runner reads the project's secret
  key from the Supabase CLI under the operator's own login
  (`projects api-keys --reveal`), holds it in memory, hands it to one
  child process through its environment, and shows the child's output
  only after every key shape has been stripped. The new secret key is
  required; the legacy service-role token is not used.
- R3. **A change on production needs the project ref repeated**
  (`--confirm <ref>`), checked in the runner and again in the tool. The
  rule is the code's: the manifest cannot relax it.
- R4. **The proof never runs on production**, and refuses to start while
  a window is open. The rule is the code's.
- R5. **Every refusal comes before the key is asked for and before the
  network**: unknown target, unknown command, a missing ref, the proof on
  production, hours out of range, a reason outside the list, a code file
  inside the repository.
- R6. **The local lane is unchanged**: without a named hosted target the
  tools accept the loopback stack only, as before; a hosted target never
  reads the local variables.
- R7. **The review code**: one file per target in the approvals folder
  (`review-code-staging.txt`, `review-code-production.txt`), never inside
  the repository, never printed; `check-review-sign-in` reads it and
  never creates one.
- R8. **The review address** on a hosted project is Honeybee's review
  mailbox, `review@myhbcfo.com`; the synthetic address stays local.
- R9. **The switch keeps the floor**: a pause or a resume sends the
  minimum app version the service already holds unless the operator names
  another.
- R10. **The suites hold on a project that carries the review tenant and
  a used switch**: pgTAP counts in its own scope and from where the state
  stands.

## 4. Threats and how they are met

| Threat                                                         | Met by                                                                                                                                            |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1. The secret key leaks through output, a file, or a log      | R2; the redaction and key-selection tests; the secrets gate over the tree and the evidence                                                        |
| T2. The tooling is pointed at an origin that is not Honeybee's | R1; origin tests (scheme, port, credentials, suffix, path, query); the tool re-checks what the runner handed over                                 |
| T3. A command meant for staging lands on production            | The target is named on the command line; R3; R4; CLI negatives that reach no network                                                              |
| T4. The review identity can sign in outside a window           | Unchanged server rules (WO-009); the seed sets no password; the proof's negatives before, after expiry, after close, after retirement             |
| T5. The review identity sees another client's rows             | Row-level security; the proof reads exactly one environment, one case, two requests on a project that holds four other cases                      |
| T6. A proof or a rehearsal leaves a way in                     | The proof retires the tenant and deletes its second identity; the state read back as the database owner shows no usable password anywhere         |
| T7. The review code is committed or shown                      | R7; the evidence scan for long digit runs                                                                                                         |
| T8. Flipping the switch silently lowers a version floor        | R9; unit test                                                                                                                                     |
| T9. Anyone with the desktop can run the mode                   | Custody is the CLI login on the operator's machine, recorded in the runbook; a second operator needs a login of their own on the organization     |
| T10. Long-lived legacy keys stay valid on the hosted projects  | Found and recorded, not changed: both projects still issue the legacy tokens, which nothing in HIVE uses; disabling them is Kody's dashboard step |

## 5. Decisions recorded (provisional, Kody's to ratify)

| Decision                                  | As built                                                                                                                                                     |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The new secret key, read per command      | Never stored; the legacy service-role token is refused by shape                                                                                              |
| The manifest                              | `security/hosted-targets.json`: two targets, exact origins, the review address, nothing key-shaped                                                           |
| `review@myhbcfo.com` on both projects     | One role address for the store's notes; it must exist as a mailbox or alias before anyone types it into the app, because the app then emails a code to it    |
| The ref repeated for production changes   | `--confirm <ref>`, in the runner and in the tool                                                                                                             |
| The proof on staging only                 | Refused on production in code; refuses while a window is open                                                                                                |
| One code file per target                  | In the approvals folder; deleting the file rotates the code at the next open                                                                                 |
| Production is seeded at Kody's word       | The review tenant is the one synthetic thing production will ever hold; it amends "production never carries a seed" and waits for "seed production"          |
| Staging is left retired                   | After the proof and the rehearsal: the rows inert, the identity unregistered with no membership, no window                                                   |
| The switch through the same mode          | `service-status`, `pause-service`, `resume-service`; custody as in T9; the floor kept                                                                        |
| The suites made independent of this state | 003 and 006 count in the seeded environment; 012 counts the switch from where it stands; 013 and 014 start from no review state inside their rolled-back run |

## 6. Proof

- Script tests `tests/scripts/hosted-operator.test.mjs`: the manifest and
  its cross-checks, targets and origins, the confirmation rule, key
  selection and redaction, the operator context in both lanes, the code
  file, the switch's approved origin and kept floor, and the tools'
  refusals run as processes with the network replaced by a tripwire.
- `prove-review` on staging: the local harness's review path against the
  hosted project, plus what only a hosted run shows.
- The operator's own sequence on staging with the real digits-only code:
  seed, open, check, close, the check refused, sweep, retire.
- The switch on staging: paused, read as the app reads it, resumed.
- Production: `review-window-status` and `service-status` only, and its
  state read as the database owner.
- pgTAP on staging and locally with the review tenant and a used switch
  present; the local harness and the live bridge on the refactored tools.

## 7. Not in this work order

- Seeding production (Kody's word) and the review mailbox (his alias).
- The reviewer's flow on a device against a hosted project: it sends a
  code to the review address, so it waits for the mailbox.
- Invitations of real identities on production: their own tooling, with
  the values only Kody can give.
- A candidate hardening, recorded for later: the password guard fires on
  an update of the hash; a user created together with a password by the
  server role keeps it until the next sweep, at most a minute. Only a
  holder of the secret key can do that, and the tooling never does.

## 8. Execution record

Runs of 2026-09-30 on Kody's desktop (evidence:
`security/evidence/2026-09-30-hosted-operator/`):

| Proof                                     | Result                                                                                                                                    |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Script tests                              | 451 in all, 415 passed, 36 skipped by platform, 0 failed; the 37 new ones in `hosted-operator.test.mjs`                                   |
| `prove-review` on staging                 | 33 checks, 0 failed                                                                                                                       |
| The operator's sequence on staging        | seed, open (code generated into the approvals folder), check PASS, close, check refused (400), sweep, retire                              |
| The switch on staging                     | open, paused (the app's read shows paused), open again; production's switch read only                                                     |
| Staging afterwards, as the database owner | the identity retired, no session, no membership, three windows all closed, no usable password anywhere, the schedule active               |
| Production, as the database owner         | 0 users, 0 sessions, 0 environments, 0 memberships, 0 windows, 0 receipts; the schedule active                                            |
| pgTAP on staging                          | 14 files, 511 assertions, PASS, with the review tenant present and the switch used                                                        |
| pgTAP locally                             | 14 files, 511 assertions, PASS, with the tenant registered, a window open, and the switch used                                            |
| The local harness and the bridge          | 400 checks, 0 failed; 7 suites, 13 tests                                                                                                  |
| Gates                                     | lint, format, typecheck, types check, toolchain, privacy, maestro:validate, config:check (both profiles), audit gate, eas:guard, jest 733 |

Two findings during the build, both corrected:

- **Five pgTAP assertions depended on a database that had never held the
  review tenant.** The first staging run after the proof failed 003 (28),
  006 (7), 013 (10), and 014 (14, 23): totals that now included the
  review case and its receipts. Suite 012 had the same dependence on a
  switch that had never been used. They now count in their own scope and
  from where the state stands (`pgtap-staging-before-suite-fix.log`, then
  `pgtap-staging.log`).
- **GoTrue cannot load the SQL-seeded placeholder identities on staging**
  (HTTP 500 on any read of them), so the local harness's "seeded client"
  negative cannot run there. The proof creates a throwaway second
  identity through the Auth Admin API instead and deletes it.
