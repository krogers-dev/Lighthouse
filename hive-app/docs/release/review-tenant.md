# The store review tenant (WO-007, prepared 2026-09-28)

**Status: option A decided by Kody in writing on 2026-09-29 and built the
same day (WO-008, `docs/plans/2026-09-29-wo-008-review-tenant.md`).
What follows is the record of the options as they were put to him, then
how the decided option works.**

## The problem

App Review needs to sign in. HIVE's sign-in is a one-time code sent by
email, and staff sign-in adds an authenticator. A reviewer has neither
the mailbox nor the authenticator, and HIVE has no self-registration and
no password.

## Options

| Option | Shape                                                                                                                                                                                                                                                                                                                                                                     | Risk                                                                                                                                                                            |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A      | A dedicated review environment (its own `environment_id`, one synthetic client and entity, seeded synthetic evidence) and one review identity whose one-time code is a fixed value accepted ONLY for that identity and ONLY in that environment, through a reviewed server-side hook; disabled everywhere else; every use audited. Plus a demo video in the review notes. | A fixed code is a deliberate authentication exception; bounded to one synthetic tenant, it exposes nothing real, but it must be built, reviewed, and rotated with each release. |
| B      | A review identity whose sign-in mailbox Honeybee controls, with a person relaying the code during review, plus a demo video.                                                                                                                                                                                                                                              | Review happens on the reviewer's schedule; a relay is unreliable and Apple may reject the app for an unusable demo account.                                                     |
| C      | Demo video only, with the "cannot provide a demo account" explanation.                                                                                                                                                                                                                                                                                                    | Both stores may refuse to review an app they cannot open.                                                                                                                       |

## Recommendation

Option A, with these bounds written into the decision:

- The review environment holds synthetic data only, seeded by the same
  seed script with a separate key, and is visible to no real client.
- The fixed code is set per release, held by Kody, never in the
  repository, and enforced by the server for the review identity alone.
- The identity is a client user; the staff surface is shown in the demo
  video instead of a staff review login, so no authenticator exception is
  ever made.
- Every sign-in of the review identity writes an audit receipt, and the
  environment is retired after each review window.

## As built (option A)

- The review identity (`review.reader@example.invalid` locally; a
  Honeybee-controlled address on a hosted project) is a client user of a
  dedicated synthetic review environment seeded by `seed-review`.
- On a plan with GoTrue's password-verification hook, the hook admits
  that identity alone and only while a review window is open; ten wrong
  codes close the window; every attempt is audited. On every other plan
  (WO-009, the fallback Kody chose): a trigger replaces any password hash
  written for anyone but the review identity inside an open window, a
  scheduled sweep expires windows within a minute of their close time and
  revokes the identity's sessions, and closing or retiring ends access on
  the server; wrong codes are not counted there, and GoTrue's rate limit
  and the code's length stand in.
- `open-review-window [hours]` sets the code from the file
  `HIVE_REVIEW_CODE_FILE` names (outside the repository; generated if
  absent, never printed); `check-review-sign-in` signs in with that code
  as the app does and reads what the session sees, then signs out;
  `close-review-window` replaces the code; `retire-review` ends all
  access.
- The reviewer enters the review email and the review code on the
  ordinary sign-in and code screens; nothing in the app is different for
  them.
- Hosted: the hook is a Teams/Enterprise feature of the hosted platform
  (2026-09-29: the Free-plan staging project refuses any auth update that
  names it), so first Kody's decision in the WO-008 plan's open finding
  (decided 2026-09-29: the fallback, in which the window tooling and a
  scheduled sweep govern the review password, built as WO-009); then give
  the identity a controlled mailbox, open a window per submission, and
  put the email and the code in the review notes for that window. The
  tools reach a hosted project through the operator mode of WO-011, below.

## On a hosted project (WO-011, 2026-09-30)

The same tools run against staging or production through
`scripts/hosted-supabase.mjs`
(`docs/plans/2026-09-30-wo-011-hosted-operator-mode.md`). It reaches the
two projects in `security/hosted-targets.json` and nothing else, reads
the project's secret key from the Supabase CLI under the operator's own
login for one command, and keeps it nowhere. The review identity there is
`review@myhbcfo.com`, which must exist as a mailbox or an alias before
anyone types it into the app, because the app then emails a code to it.
A change on production needs its project ref repeated. Proven on staging
on 2026-09-30 (`security/evidence/2026-09-30-hosted-operator/`);
production is seeded at Kody's word.

For a submission, in order:

```bash
node scripts/hosted-supabase.mjs production seed-review --confirm nceencyvxfhkffbjqlea
```

```bash
node scripts/hosted-supabase.mjs production open-review-window 168 --confirm nceencyvxfhkffbjqlea
```

```bash
node scripts/hosted-supabase.mjs production check-review-sign-in --confirm nceencyvxfhkffbjqlea
```

The code is in `%USERPROFILE%\HIVE-approvals\review-code-production.txt`
and nowhere else; it and the review address go into the review notes. A
window lasts at most seven days. If a review runs longer, open a new
window once the first has ended: the file's code is set again, so the
notes stay right. Deleting the file before an open rotates the code.
When the review ends:

```bash
node scripts/hosted-supabase.mjs production close-review-window --confirm nceencyvxfhkffbjqlea
```

`retire-review` ends all access between releases, and
`review-window-status` reads the state at any time without the ref.
Staging takes the same commands without `--confirm`, and `prove-review`
there runs the whole black-box path.

## The demo video

The staff surface for the reviewer notes (the approved case with its
sources and permanent record on a staff session) was recorded on the
emulator on 2026-09-29 from reviewer.rae's real AAL2 session, starting
only after the login and never showing the enrollment screen. It is kept
outside the repository, in Kody's approvals folder
(`HIVE-approvals\review-demo\`), for him to attach to the review notes.

## What Kody decides next

1. Which option.
2. If A: the hosting of the review environment (the same hosted project
   as staging, or its own), the custody of the fixed code, and the review
   window rule.

Until then, the review-account mechanism is HOLD, and the store
submission checklist (`signing-and-submission.md`, step 10) cannot
complete.
