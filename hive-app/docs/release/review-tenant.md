# The store review tenant (WO-007, prepared 2026-09-28)

**Status: options and a recommendation for Kody. Nothing is built: the
mechanism touches authentication and is a security decision.**

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

## What Kody decides

1. Which option.
2. If A: the hosting of the review environment (the same hosted project
   as staging, or its own), the custody of the fixed code, and the review
   window rule.

Until then, the review-account mechanism is HOLD, and the store
submission checklist (`signing-and-submission.md`, step 10) cannot
complete.
