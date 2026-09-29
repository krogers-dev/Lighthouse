# Milestone 6 on the desktop — 2026-09-28

The Milestone 6 (WO-007, store release candidate: preparation within the
HOLD boundary) lanes, executed on Kody's Windows desktop from a local
Claude session, at the tree committed with this record (Milestone 5 head
`0a243b1`, its ratification record `cf0e6c8`, and the Milestone 6
change). Emulator `Pixel_8` (API 35), Docker stack (Supabase CLI
2.115.0), Maestro 2.10.0, Node 22.23.2, the Milestone 2 QA build reused
unchanged (no native module was added), with Metro restarted for each
bundle and the served bundle checked for the new ids before every device
run. Nothing here signs, submits, publishes, deploys, creates an account,
accepts a term, or touches live data. Every file here is as captured;
logs had CR line endings stripped and nothing else changed.

| Step | Command                                                                                      | Result                                                                                                                                                                                      |
| ---- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `npx supabase db reset`, then `local-supabase.mjs seed`                                      | ✅ "9 created, 15 memberships, 5 documents, 1 source link(s) in place, all ids canonical"                                                                                                    |
| 2    | `npx supabase test db`                                                                       | ✅ Result: PASS, 12 files, 457 asserts (suite 012: 47; suites 007 to 011 now count two restrictive layers) — `pgtap-cli-stack.log`                                                          |
| 3    | `local-supabase.mjs e2e` (black-box harness, fresh seed)                                     | ✅ 373 passed, 0 failed; step 4d is the release-controls path, with `account_deletion_requests` in every exact-reach proof — `harness-cli-stack.log`                                          |
| 4    | `local-supabase.mjs bridge` (the app's composition, CLI stack)                               | ✅ 12 passed across 6 suites; `release-controls-live` reads the public status and drives the request, its replay, the refusal, and the withdrawal — `bridge-cli-stack.log`                     |
| 5    | `local-supabase.mjs drill-backup`                                                            | ✅ 21 tables restored with identical counts in 3s, the append-only audit history among them — `backup-drill.log`                                                                              |
| 6    | `pause-service maintenance`, `maestro test .maestro/service-paused.yaml`, `resume-service`, `maestro test .maestro/sign-in.yaml` | ✅ the paused screen with its reason, "Try again" keeps it, nothing of the app; after resume the sign-in flow reaches Home — `maestro-service-paused.log`, `service-paused-passing-run.png` |
| 7    | `maestro test .maestro/account-deletion.yaml` (signed in as client.owner, the dev bundle carrying the deletion page) | ✅ request through one confirmation, the open request with its date, withdrawal through its own confirmation, the control back — `maestro-account-deletion.log`, the four `deletion-*.png` and `account-deletion-section.png` |
| 8    | `request-deletion` then `complete-deletion nomember.norman@example.invalid`, then `seed`     | ✅ the auth user gone, the request kept with a null user and a pseudonymous subject, the seed restoring the identity ("1 created, 8 verified existing") — `device-lane-part2-and-deletion-drill.log` |
| 9    | the light gates (`light-gates.log`) and the heavy gates                                      | ✅ see the work order's gate table; `config:check --profile release` FAILS by design, naming each HOLD (identifiers, origin, the support address, the deletion page)                          |

## What the desktop proved that no build container could

- **The kill switch on glass.** With the service paused by the server
  role, launching the app showed "Warning: HIVE is paused for
  maintenance" with the sentence that nothing has changed, and neither
  Home nor the sign-in screen; "Try again" read the status again and,
  with the service still paused, kept the screen
  (`service-paused-passing-run.png`). After `resume-service` the ordinary
  sign-in flow reached Home: nothing had been removed.
- **The deletion request on glass.** The Account screen's section
  explains what is removed and what the firm keeps, links the public
  page, and asks for the request through one confirmation
  (`account-deletion-section.png`, `deletion-confirmation.png`); the
  settled request reads "Done: Deletion requested" (`deletion-requested.png`);
  the open request shows its date with "Withdraw the request"
  (`open-request-with-withdraw.png`); withdrawal goes through its own
  confirmation and the control returns.
- **Completion, end to end.** The identity with no memberships asked for
  deletion as itself, the server role completed the request, the
  platform's admin API removed the auth user, the readback found the
  account gone and the request kept as a record, and the seed restored
  the synthetic identity for the next lane.

## The first device pass: two finds, both fixed before the second

- **Find 67.** The app relaunched while paused booted its auth machine
  underneath the gate, read zero memberships, and, fail-closed, signed
  the person out with reason `no_access`; the next flow met the sign-in
  screen where it expected the workspace chooser. The gate now shows a
  neutral starting screen and mounts nothing until its first status read
  settles, jest pins it, and both flows were run again on the new bundle
  (`device-lane-final-pass.log`; the paused flow's first attempt in that
  pass hit Maestro's transient driver start-up timeout and passed on the
  re-run whose log is kept here).
- **Find 68.** The flows asserted a notice's title without the spoken
  tone the notice prints before it ("Warning: …", "Done: …"); whole
  captions are asserted now.
