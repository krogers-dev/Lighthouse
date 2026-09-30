# Milestone 3 on the desktop — 2026-09-28

The Milestone 3 (WO-004, review and response) lanes, executed on Kody's
Windows desktop from a local Claude session, at the tree committed with
this record (Milestone 2 head `b051c4c` plus the Milestone 3 change).
Emulator `Pixel_8` (API 35, sdk_gphone16k_x86_64), Docker stack (Supabase
CLI 2.115.0), Maestro 2.10.0, Node 22.23.2, the Milestone 2 QA build
(`app-debug.apk`, `EXPO_PUBLIC_QA_HOOKS=1`) reused unchanged because this
milestone adds no native module, with Metro restarted for the new bundle.
Every file here is as captured; logs had CR line endings stripped and
nothing else changed.

| Step | Command                                                             | Result                                                                                                         |
| ---- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 1    | `npx supabase db reset`, then `local-supabase.mjs seed`             | ✅ "9 created, 0 verified existing, 15 memberships, 5 documents, 1 source link(s) in place, all ids canonical"  |
| 2    | `npx supabase test db`                                              | ✅ Result: PASS, 9 files, 266 asserts (suite 009: 62)                                                          |
| 3    | `local-supabase.mjs e2e` (black-box harness, fresh seed)            | ✅ 215 passed, 0 failed (step 3c, the answer path, 26 checks; the two new tables in every reach proof)          |
| 4    | `local-supabase.mjs bridge` (the app's composition, CLI stack)      | ✅ 9 passed across 4 suites (`answers-live` among them)                                                         |
| 5    | Metro restarted; `maestro test .maestro/sign-in.yaml`               | ✅ exit 0                                                                                                       |
| 6    | `maestro test .maestro/request-respond.yaml`                        | ✅ exit 0, ending on the request "Answered" with the answer on it and no control (`request-after-answer.png`)   |
| 7    | `export:candidate` (loopback origin) with its own bundle inspection | ✅ 22 text and 65 binary files, zero QA-hook markers                                                            |

## What the desktop proved that no build container could

- **The whole answer path on glass, through the phone's real session**:
  the question names the checked November statement it is about (a
  document on another request of the case, resolved inside the scope);
  "Answer this request" is the one primary action for the client user on
  the open question; the typed text lands in the paragraph field with its
  count; the request's checked document becomes a checkbox row that says
  "Checked. Referred to in your answer"; "Save draft" answers "Your draft
  is kept with the request. Nothing has been submitted."; "Submit answer"
  leads to the confirmation "Once submitted it cannot be changed, and
  Honeybee will see it. The request will show as answered."; "Submit"
  settles it; and the request then reads "Answered" with "Your answer ·
  Submitted September 28, 2026", the text, and "Refers to:
  november-balance-photo (Synthetic).png", with no answer control left.
- **The draft is server state**: the flow's save and the later submission
  went through `save_request_answer_draft` and `submit_request_answer`
  from the device with the version the screen read; the same functions
  the harness and the bridge exercised with their own sessions.
- **The reset makes the lane repeatable**: `reset-answer a1Question`
  reopened the question between the harness, the bridge, and the device
  run, and readback verified OPEN with no answer each time.

## Finds, all fixed in this run

- **Find 60 — GoTrue's one-second send floor.** The harness's repeat login
  for `preparer.pat` requested a second code within a second of the
  first on this fast stack and was refused 429 ("you can only request
  this after 0 seconds", the auth log). Step 2 already waits the floor;
  step 4 now does too. Three consecutive runs reproduced it before the
  wait; the run recorded here is 215 of 215.
- **Find 61 — the citation guard refused the cascade.** Removing a
  submitted answer with the table owner's authority (the checked reset)
  cascades into its citations, and the guard read that as "citations of
  a submitted answer are immutable". The guard now lets a cascade through
  when the answer itself is gone (`tg_op = 'DELETE'` with no answer row);
  suite 009 pins it (61, 62). Until then the bridge lane's own reset
  failed before its suites ran.
- **The harness recorded the wrong citation row.** Every save replaces the
  citation set, and with it the row ids; step 3c recorded the first
  draft's row and the AAL2 reach checks then saw the final draft's. The
  ids are now read after the final save.
- **`already_submitted` ahead of `request_closed`.** A request settled by
  the caller's own submission refused a further draft as
  `request_closed`; the more specific token is answered first (suite 009
  test 50).
- **Array arguments in the generated types.** `pg_type` names `uuid[]`
  as `_uuid`, which the generator mapped to `string`; it now renders
  `string[]` (`db-types.test.mjs`).
- **Testing-library 14 is asynchronous.** An unawaited `fireEvent` leaks
  an open act scope into the next test in the file; every event in the
  new and touched suites is awaited, and a test renders once.
- **Device: the surviving Metro.** The Metro process's command line reads
  `cli start`, not `expo start`, so the restart filter missed it; the
  second Metro could not bind 8081, skipped its dev server, and the
  device kept the old bundle (the first device run showed the Milestone 2
  detail view). The listener on the port is now what gets stopped.
- **Device: Gboard's stylus sheet.** The first time the multi-line field
  took focus, the emulator's Gboard raised a one-time "Try out your
  stylus" onboarding sheet over the app; dismissed once by hand, it did
  not return. Noted in the flow header.
- **Device: whole-text selectors.** Maestro matches text as an anchored
  regex; the flow's captions are now whole texts ("Checked. Referred to
  in your answer", the notice bodies).

## Transport failures, not app failures

The first `sign-in.yaml` run stopped at "Input text" with Maestro's
session heartbeat unable to write its own store ("another process has
locked a portion of the file"); no Maestro process was alive afterwards
and the re-run passed. Recorded because the runbook's "re-run before
calling it an app defect" rule applied once today.

## Files

- `maestro-sign-in.log`, `maestro-request-respond.log`: the passing runs'
  console output (Maestro 2.10.0).
- `request-after-answer.png`: the request after the submission (1080×2400,
  PNG signature verified).
- `harness-cli-stack.log`, `bridge-cli-stack.log`, `pgtap-cli-stack.log`:
  steps 2 to 4.
