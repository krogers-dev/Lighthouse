# The review tenant on the desktop — 2026-09-29

The review tenant (WO-008, Kody's option A) lanes, executed on Kody's
Windows desktop from a local Claude session, at the tree committed with
this record (the Milestone 6 ratification record `2d99849` and the
WO-008 change). Emulator `Pixel_8` (API 35), Docker stack (Supabase CLI
2.115.0, restarted once to enable GoTrue's password-verification hook),
Maestro 2.10.0, Node 22.23.2, the Milestone 2 QA build reused unchanged,
Metro restarted for the one app change. Nothing here touches a store, a
hosted project, or live data. Every file is as captured; logs had CR
line endings stripped and nothing else changed; no log carries a token
or the review code.

| Step | Command                                                                                             | Result                                                                                                                                                                         |
| ---- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1    | `npx supabase stop`, `npx supabase start` (the hook enabled), `db reset`, `seed`                    | ✅ the stack up with the hook; "9 created, 15 memberships, 5 documents, 1 source link(s) in place, all ids canonical"                                                           |
| 2    | `npx supabase test db`                                                                              | ✅ Result: PASS, 13 files, 487 asserts (suite 013: 30) — `pgtap-cli-stack.log`                                                                                                  |
| 3    | `local-supabase.mjs e2e` (black-box harness, fresh seed)                                            | ✅ 391 passed, 0 failed; the review tenant's whole lifecycle runs last, against GoTrue's real password grant — `harness-cli-stack.log`                                          |
| 4    | `local-supabase.mjs bridge` (the app's composition, CLI stack)                                      | ✅ 13 passed across 7 suites; the lane seeded the tenant, opened a one-hour window with a lane-only code, ran `review-tenant-live`, closed and retired — `bridge-cli-stack.log` |
| 5    | `seed-review`, `open-review-window 1`, `maestro test -e REVIEW_CODE=… .maestro/review-sign-in.yaml`, `close-review-window`, `retire-review` | ✅ the review identity signed in on the ordinary screens and saw only the review workspace; 0 failed attempts; the code appears in no log — `maestro-review-sign-in.log`, `device-lane.log`, `review-workspace.png` |
| 6    | the light and heavy gates                                                                           | ✅ see the work order's gate table (`light-gates.log`)                                                                                                                          |

## What the desktop proved that no build container could

- **A reviewer's path, unchanged screens.** The review identity typed
  its email on the sign-in screen and the sixteen-digit review code on
  the code screen, which the server refused as a one-time code and then
  admitted as the review code; Home showed "Review Bakery LLC
  (Synthetic)" and the review case, and nothing of Harbor Light Bakery
  (`review-workspace.png`).
- **The code never left the lane file.** Maestro received it as a
  variable and logged only the placeholder; the tooling printed only
  that it had generated and set it; the lane deleted its file at the
  end; the window closed with zero failed attempts and the tenant was
  retired.

## Finds, all fixed in this run

- **Find 73.** The code screen is a number pad: a code of letters is not
  what reaches the field. Review codes are twelve to twenty digits now
  (`scripts/lib/review-code.mjs`), and the loader refuses anything else.
- **Find 74.** A flow-level `env` default wins over the command line, so
  the placeholder was typed and counted as a wrong attempt twice; the
  flow declares no default and the code arrives only as `-e`.
- **Find 75.** A node test that imported the window CLI met its
  environment guard and exited; the code loader lives in a library the
  test imports instead.
