# Milestone 2 on the desktop — 2026-09-28

The seven runbook steps (README, "Milestone 2 on the desktop"), executed
on Kody's Windows desktop from a local Claude session, at candidate
`2f7b555` plus the two fixes this run produced (finds 58 and 59,
committed with this record). Emulator `Pixel_8` (API 35,
sdk_gphone16k_x86_64), Docker stack (engine 29.7.2), Supabase CLI
2.115.0, Maestro 2.10.0, Node 22.23.2. Every file here is as captured;
logs had CR line endings stripped and nothing else changed.

| Step | Command                                                                    | Result                                                                                                        |
| ---- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 1    | `local-supabase.mjs up --android-emulator`, then `seed`                    | ✅ `.env.local` origin `http://10.0.2.2:54321`; "0 created, 9 verified existing, 15 memberships, 4 documents" |
| 2    | `npx supabase test db`                                                     | ✅ Result: PASS, 8 files, 204 asserts (run earlier the same day at this candidate; see the WO-003 record)      |
| 3    | `npx expo prebuild --platform android --clean`, then the QA build          | ✅ BUILD SUCCESSFUL in 1m 40s; `app-debug.apk` installed; QA hook line present at launch                       |
| 4    | `maestro test .maestro/sign-in.yaml`, then `request-add-document.yaml`     | ✅ sign-in exit 0 (31 s); add-document exit 0 (37 s), ending on "Received, being checked"                      |
| 5    | `local-supabase.mjs scan-quarantine`                                       | ✅ 5 scanned, 5 accepted, 0 not accepted; the device document reads "Checked" (screenshot)                     |
| 6    | `local-supabase.mjs sweep-uploads`                                         | ✅ "0 expired; 0 settled object(s) removed" (nothing stale on a same-day stack)                                 |
| 7    | `local-supabase.mjs bridge`                                                | ✅ 8 passed across 3 suites                                                                                     |

## What the desktop proved that no build container could

- **The device digest is the server's digest.** The QA document
  (`hive-qa-document (Synthetic).pdf`, 277 bytes) was digested on the
  phone by `expo-crypto` (`20d8ace3…39e34`), reserved under that
  digest, transferred into `hive-quarantine` at the reserved path, and
  accepted by the synthetic scanner, which recomputed SHA-256 over the
  stored object and compared. Size and digest matched.
- **The storage policy admits the phone's real session** at exactly the
  reserved path (a live sign-in through OTP, not a harness token).
- **The production reader and discard path work on a cache copy**: the
  QA source writes the synthetic PDF into the app cache the way the
  platform picker's copy lands, and the read, the check, and the discard
  are the shipped code (the file was present in `run-as … ls cache`
  during the attempt).
- **On glass**: the seeded documents with their true statuses, the one
  "Add a document" control for a client user on an open request, the
  checked panel with name, type, and size, the received notice, and the
  document listed on the request first as "Received, being checked" and,
  after the scan, as "Checked" — never "Approved" or "Filed"
  (`verify-checked-adhoc.yaml`, an ad-hoc flow kept here, not in
  `.maestro/`).

## Two finds, both fixed in this run

- **Find 58 — the native digest takes a typed array.** The first pass
  through "Choose a file" ended in "The document was not sent — Something
  went wrong" with no document panel: the check phase had thrown.
  `expo-crypto`'s Android module (`digest(algorithm, output: TypedArray,
  data: TypedArray)`) converts its data argument as a typed array and
  refuses the bare `ArrayBuffer` the adapter passed. The adapter now
  hands it `new Uint8Array(exactArrayBuffer(bytes))`, and a jest contract
  test against mocked native modules pins "a typed array over exactly the
  bytes, never a bare buffer" (`src/features/documents/__tests__/expo-adapters.test.ts`).
  Localized from the failure screenshot plus `adb shell run-as … ls
  cache` (the synthetic PDF was there, so the pick and the write had
  succeeded).
- **Find 59 — the documents section is below the fold.** The request
  detail's table pushes the Documents section under the viewport at
  default text size, so the flow's `assertVisible` on a seeded document
  name could never see it (`assertVisible` is viewport-only, find 17).
  The flow scrolls each name into view with `scrollUntilVisible` (text
  selector) before asserting, and centres the newly received document
  when it returns to the request.

## Transport failures, not app failures

Maestro's on-device server (`.mobile.maestro`) segfaulted twice in five
runs (`grpc-nio-worker`, "Device server died during 'viewHierarchy'"):
once on the first `sign-in.yaml` (step "Assert that id: sign-in-email is
visible" left with no verdict) and once on the second `request-add-document.yaml`
(after "Tap on id: add-document-choose"). The app process was healthy
both times (no fatal in `ive.development`; the QA hook lines continued).
Each re-run passed. Recorded because the runbook's "re-run before calling
it an app defect" rule (2026-09-06) applied twice today.

## Runbook notes earned today

- `npx expo run:android --device` wants the AVD NAME (`Pixel_8`); given the
  adb serial it fails "Could not find device" and leaves the previous
  binary installed, and the new bundle then crashes that binary at launch
  (a missing native module). With one device attached, omit `--device`.
- Metro started with `CI=1` has no file watcher ("reloads are disabled"):
  after any source edit, restart Metro before relaunching the app, or the
  flows measure the old bundle.

## Files

- `maestro-sign-in.log`, `maestro-request-add-document.log`: the passing
  runs' console output (Maestro 2.10.0).
- `maestro-verify-checked-adhoc.log`, `verify-checked-adhoc.yaml`: the
  ad-hoc after-scan check and its flow.
- `request-after-scan.png`: the request after the scan (1080×2400, PNG
  signature verified).
- `scan-quarantine.log`, `sweep-uploads.log`, `bridge-cli-stack.log`:
  steps 5 to 7.
