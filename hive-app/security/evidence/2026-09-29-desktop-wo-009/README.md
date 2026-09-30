# WO-009 — the review tenant without the hook — 2026-09-29

Executed on Kody's Windows desktop from a local Claude session, at the
tree committed with this record, at his written instruction ("Go with the
fallback, build it now"). The local stack ran with GoTrue's
password-verification hook OFF, as the hosted projects do; every proof
below is of the fallback, not the hook.

| Step | Command                                                                                          | Result                                                                                                                                                           |
| ---- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `supabase stop`, `supabase start` (hook off), `supabase db reset`, `local-supabase.mjs seed`     | ✅ migration `20260929120014` applied; the seed in place                                                                                                          |
| 2    | `supabase test db`                                                                               | ✅ 14 files, **511 assertions, PASS** (24 new in suite 014; 013 unchanged) — `pgtap-local.log`                                                                     |
| 3    | `local-supabase.mjs e2e` (the black-box harness, step 4e in fallback mode)                       | ✅ **400 checks, 0 failed**; the review-tenant lines in `harness-review-tenant.log`: refused without a window, wrong code not counted, sign-in and exact reach, the owner negative, the sweep expiring the window with the code and the session, a second window closed with the same effect, both close reasons on the trail, retirement |
| 4    | `local-supabase.mjs bridge` (the live app-level tests)                                           | ✅ 7 suites, 13 tests, including the reviewer's sign-in through the shipped composition                                                                          |
| 5    | `seed-review`, `open-review-window 1`, `maestro test -e REVIEW_CODE=… .maestro/review-sign-in.yaml`, `close-review-window`, `retire-review` | ✅ the reviewer signed in on the ordinary screens with the code and saw only the review workspace — `device-review-workspace.png`; the close revoked the sessions |
| 6    | `supabase db push` to staging and by connection string to production                             | ✅ the migration on both; the schedule `hive-review-window-sweep` active on both; the trigger on `auth.users` on both; one successful run each within the minute; staging's sweep replaced its one stray hash, production's found none — `db-push-staging.log`, `db-push-production.log` |
| 7    | `db:types` regenerated and checked; typecheck, lint, format, script tests, toolchain, privacy, maestro:validate, config:check, audit gate | ✅ all OK (the jest suite and the export gate are in the commit's record)                                                                                          |

## What this proves

- The three rules of the review sign-in hold without the hook, through
  GoTrue itself: nobody but the review identity inside an open window
  can hold a password, a window ends at its close time, and closing or
  retiring ends access including sessions.
- The reviewer's experience is unchanged on the device.
- Both hosted projects enforce the same rules from the minute the
  migration landed.

## What this does not prove

- Counting of wrong codes: the hook did that; without it the rate
  limit, the code's length, and the window's close time bound the
  exposure (the harness asserts the zero count in fallback mode).
- The hook itself on this build: its proof is suite 013 at the function
  level and the documented hook-on pass (`HIVE_REVIEW_HOOK=on`).
