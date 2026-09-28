# Milestone 4 on the desktop — 2026-09-28

The Milestone 4 (WO-005, internal review and approval) lanes, executed
on Kody's Windows desktop from a local Claude session, at the tree
committed with this record (Milestone 3 head `6234f12`, the ratification
record `d5c2483`, and the Milestone 4 change). Emulator `Pixel_8` (API
35), Docker stack (Supabase CLI 2.115.0), Maestro 2.10.0, Node 22.23.2,
the Milestone 2 QA build reused unchanged (no native module was added),
with Metro restarted for the new bundle. Every file here is as captured;
logs had CR line endings stripped and nothing else changed.

| Step | Command                                                                                  | Result                                                                                                               |
| ---- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 1    | `npx supabase db reset`, then `local-supabase.mjs seed`                                  | ✅ "9 created, 15 memberships, 5 documents, 1 source link(s) in place, all ids canonical"                             |
| 2    | `npx supabase test db`                                                                   | ✅ Result: PASS, 10 files, 356 asserts (suite 010: 90)                                                                |
| 3    | `local-supabase.mjs e2e` (black-box harness, fresh seed)                                 | ✅ 288 passed, 0 failed (step 4b, the review path, with three staff identities at AAL2 and the three tables in every reach proof) |
| 4    | `local-supabase.mjs bridge` (the app's composition, CLI stack)                           | ✅ 10 passed across 5 suites (`review-live`: preparer, reviewer, approver journeys)                                    |
| 5    | `reset-case a1`, then `stage-case a1 ready-for-review`                                   | ✅ "a1 frozen as package 1 (READY_FOR_REVIEW)" through a real preparer sign-in at AAL2                                |
| 6    | Metro restarted; `npm run maestro:enroll -- --then case-review.yaml`                     | ✅ `maestro:enroll OK`: reset, enroll, sign-out, login on the same factor, the case review, revoke                     |
| 7    | `export:candidate` (loopback origin) with its own bundle inspection                      | ✅ see the work order's gate table                                                                                    |

## What the desktop proved that no build container could

- **The staff surface on the phone's real AAL2 session.** After the
  runner's OTP sign-in and TOTP login as reviewer.rae, Home's case row
  opened the case review; the frozen package showed its number, the
  freeze date and role, the full digest, the case's requests by title
  with their frozen versions, one submitted answer as a text digest, and
  three checked documents by size and digest (`start-review-confirmation.png`,
  captured at the "Start the review?" confirmation, which says review is
  read-only).
- **Two transitions on glass, each confirmed.** "Start review" moved the
  case to "In review" and the flow started fresh on the new version with
  the verdict form; PASS with a note went through the "Record this
  verdict?" confirmation; the case then read "Awaiting approval" with the
  reviewer's PASS and note on record, no approval, and "Nothing for you to
  do on this case right now" (`case-after-pass.png`).
- **The factor hygiene held.** The runner confined every artifact,
  revoked the disposable factor, scrubbed the clipboard, and removed the
  tree; the frames here were captured from the host only after the
  runner announced the review flow, never while the enrollment screen was
  up, and the runner's console log names steps, never values.

## Finds, all fixed in this run

- **The Home route never passed the opener.** The first device run tapped
  the case row and nothing opened: the route's `onOpenCase` edit sat
  behind a failed edit in the same script and was never applied, so the
  row was a plain view. The route now passes it; typecheck could not
  catch an optional prop left out.
- **A viewport-only last step.** The flow's final `assertVisible` on the
  "nothing to do" line sat below the fold after centering the verdicts;
  it scrolls now (find 17's rule, again).
- **The runner gained `--then <flow>`** to run one staff flow on the AAL2
  session its login proves, inside the same confinement and cleanup, and
  its unit test pins the sequence and the file-name rule.
- **`stage-case` and `reset-case`** exist because a device flow needs the
  case in a workflow state and a real preparer to put it there; staging
  signs the staff in for real (OTP, TOTP) and calls the transitions.

## Files

- `maestro-enroll-then-case-review.log`: the runner's console output for
  the passing sequence (steps only; no code, key, or secret is printed).
- `start-review-confirmation.png`, `case-after-pass.png`: host captures
  during the review flow (1080×2400, PNG signature verified).
- `harness-cli-stack.log`, `bridge-cli-stack.log`, `pgtap-cli-stack.log`:
  steps 2 to 4.
