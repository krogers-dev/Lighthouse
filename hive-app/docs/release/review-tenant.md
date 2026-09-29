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
- GoTrue's password-verification hook, in Postgres, admits that identity
  alone and only while a review window is open; ten wrong codes close the
  window; every attempt is audited.
- `open-review-window [hours]` sets the code from the file
  `HIVE_REVIEW_CODE_FILE` names (outside the repository; generated if
  absent, never printed); `close-review-window` replaces it;
  `retire-review` ends all access.
- The reviewer enters the review email and the review code on the
  ordinary sign-in and code screens; nothing in the app is different for
  them.
- Hosted: the hook is a Teams/Enterprise feature of the hosted platform
  (2026-09-29: the Free-plan staging project refuses any auth update that
  names it), so first Kody's decision in the WO-008 plan's open finding
  (the plan that permits it, or the proposed fallback in which the window
  tooling and a scheduled sweep govern the review password); then give
  the identity a controlled mailbox, open a window per submission, and
  put the email and the code in the review notes for that window.

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
