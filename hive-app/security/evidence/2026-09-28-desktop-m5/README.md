# Milestone 5 on the desktop — 2026-09-28

The Milestone 5 (WO-006, source adapters) lanes, executed on Kody's
Windows desktop from a local Claude session, at the tree committed with
this record (Milestone 4 head `eb1a974`, the ratification record
`bdd86a0`, and the Milestone 5 change). Emulator `Pixel_8` (API 35),
Docker stack (Supabase CLI 2.115.0), Maestro 2.10.0, Node 22.23.2, the
Milestone 2 QA build reused unchanged (no native module was added), with
Metro restarted for the new bundle and the served bundle checked for
the new section id before the device run. No live ledger and no live
Drive was touched: both adapters are the named synthetic stand-ins.
Every file here is as captured; logs had CR line endings stripped and
nothing else changed.

| Step | Command                                                                                                          | Result                                                                                                                                                                        |
| ---- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `npx supabase db reset`, then `local-supabase.mjs seed`                                                          | ✅ "9 created, 15 memberships, 5 documents, 1 source link(s) in place, all ids canonical"                                                                                      |
| 2    | `npx supabase test db`                                                                                           | ✅ Result: PASS, 11 files, 410 asserts (suite 011: 54) — `pgtap-cli-stack.log`                                                                                                 |
| 3    | `local-supabase.mjs e2e` (black-box harness, fresh seed)                                                         | ✅ 341 passed, 0 failed; step 4c is the source path, with both new tables in every exact-reach proof — `harness-cli-stack.log`                                                  |
| 4    | `local-supabase.mjs bridge` (the app's composition, CLI stack)                                                   | ✅ 10 passed across 5 suites; `review-live` now continues as intake.beth reading the synced references and recording a receipt — `bridge-cli-stack.log`                        |
| 5    | `reset-case a1`, `stage-case a1 approved`, `sync-ledger a1`, `stage-filing a1`, `verify-filings a1`               | ✅ the case APPROVED through three real staff sign-ins, three references recorded by `HiveSyntheticLedger`, two receipts by intake at AAL2, one VERIFIED and one MISMATCH by `HiveSyntheticDrive` — `stage-approved-sync-file-verify.log` |
| 6    | Metro restarted; `npm run maestro:enroll -- --then case-sources.yaml`                                            | ✅ `maestro:enroll OK` on the second run (the first died with the emulator's system process, below) — `maestro-enroll-then-case-sources.log`                                   |
| 7    | `export:candidate` (loopback origin) with its own bundle inspection                                              | ✅ see the work order's gate table                                                                                                                                             |

## What the desktop proved that no build container could

- **The sources on the phone's real AAL2 session.** After the runner's
  OTP sign-in and TOTP login as reviewer.rae, Home's case row opened the
  approved case (`case-approved-top.png`: "Approved", case version 25,
  package 1 with its full digest). The Sources section listed the three
  ledger objects the synthetic adapter read, each as a label, a type, a
  version, an as-of date, and a digest, "read by HiveSyntheticLedger",
  under the sentence that HIVE holds what was referred to and when,
  never its contents (`sources-three-references.png`). No value of any
  kind is on the screen, because none exists in the shape.
- **The permanent record, verified and not.** The Permanent record
  section showed the two receipts intake recorded by hand: the July
  statement at `drv-synthetic-0001`, "Verified in the record", checked
  by HiveSyntheticDrive; and the November statement at
  `drv-synthetic-wrong`, "Did not match the record", with the digest the
  adapter found; each with its folder path, its filer's role, its date,
  and its claimed digest (`permanent-record-verified-and-mismatch.png`).
  The section says, in words, that filings are made by hand and that
  HIVE never writes to Drive. A reviewer has no action on an approved
  case: "Nothing for you to do on this case right now."
- **The factor hygiene held.** The runner confined every artifact,
  revoked the disposable factor, scrubbed the clipboard, and removed the
  tree; the frames here were captured from the host only after the
  runner announced the sources flow, never while the enrollment screen
  was up, and the runner's console log names steps, never values.

## The first device run: the emulator's system process died

The first `--then case-sources.yaml` run failed at the flow's first
wait for Home. Host frames show the app's splash and then a black
screen; `adb logcat -d -b crash` shows the Android system process
throwing a fatal exception at that instant and every running app,
HIVE's development build among them, dying with `DeadSystemException:
The system died` (`run1-system-process-death-crash-buffer.txt`,
`run1-system-process-death-runner.log`). Maestro's next flow could not
reach the package service (`cmd: Can't find service: package`), so the
runner's clipboard scrub did not run and the runner said so; the scrub
flow was run by hand once the system was back, the device's boot flag
and free memory (898,944K) were checked, and the lane was run again
end to end. A device fault, not an app fault; the staged case survived
untouched because the runner only handles reviewer.rae's factor.

## Finds, all fixed in this run

- **Find 62.** The server accepted an all-blank Drive path where the app
  refuses one (the harness sent three spaces); `record_filing_receipt`
  now trims and refuses a blank path, and pgTAP 011 pins it.
- **Find 63.** The live client journey's trail-family check did not know
  the `source.` and `record.` families once the bridge lane synced the
  synthetic ledger; it does now.
- **Find 64.** The emulator's system-process death above, recorded so the
  next run recognizes the shape (frames, crash buffer, the package
  service error, the skipped scrub).
