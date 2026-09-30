# Work Order 003 — Milestone 2: Controlled document request

**Status: executed 2026-09-28 on Kody's desktop, under Kody's standing
instruction of 2026-09-18 ("just RUN … you know what I need, and you know
how to properly build it").** Every product decision this milestone
needed is recorded as provisional in `security/APPROVALS.md` for his
one-line ratification; none of them touches a HOLD item. No production
data, integration, signing, submission, or release work was performed.
Everything runs on synthetic `example.invalid` identities and synthetic
files.

**Owner:** Kody (acceptance, security, capability). **Wording:** Stacie.

## Provenance: a milestone built twice

Milestone 2 was first built on 2026-09-18 in a cloud session and
committed there as `f0ae940`, together with Milestones 3 (`624016d`) and
4 (`58303a4`). That session's GitHub connection had been down since
2026-09-13; the three commits were never pushed, and on 2026-09-28 the
session's container was gone with them. The GitHub branch stayed at
`118b891`. This execution rebuilds Milestone 2 from that head on Kody's
desktop, with the cloud session's transcript as the only surviving
record of what it had decided (its gate report, its list of decisions,
and its status notes). Where this document says "as before", that is
what it means; the code is new.

## 1. Outcome

On an open request, a client user can add a document: pick it with the
system picker, have it checked and digested on the phone, transfer it
into a private quarantine bucket, and see it on the request as
"Received, being checked" until Honeybee's check settles it as "Checked"
or "Not accepted". Staff see the documents on a request and never the
control. No document becomes evidence on its own, nothing is filed
anywhere, and Google Drive remains the permanent record with filing
still manual (PRODUCT.md).

Explicitly excluded: automatic Drive filing, a real malware scanner
(HOLD until Kody approves one; a named synthetic stand-in runs locally),
client answers and submission (Milestone 3), review and approval
(Milestone 4), any read-back or download of a quarantined object.

## 2. Requirements

### Functional

- R1. A `document_uploads` row per transfer, scoped exactly like
  `requests` (composite key into the case AND into the request, indexed
  policy columns, permissive membership policy, restrictive staff-AAL2
  policy), `SELECT`-only for clients. The server lifecycle is
  `UPLOADING → QUARANTINED → VALIDATING → ACCEPTED | REJECTED`, with
  `EXPIRED` reachable from the three live states; a trigger enforces the
  transitions, freezes identity columns, and bumps a version on every
  update.
- R2. The transfer is three reviewed server round trips. `begin`
  reserves a path (idempotency key, the request's object version, exact
  scope triple, server time, atomic audit receipt: the brief's
  protected-mutation contract), applying every limit; the client inserts
  the object at exactly that path; `complete` verifies the object exists
  at the declared size and moves the row into quarantine, appending an
  enumerated activity event.
- R3. The quarantine bucket is private, bounded at the storage service
  (20 MB, four MIME types), and carries ONE policy: `INSERT` by the
  reserving client user at the reserved path while the reservation is
  live. No `SELECT`, `UPDATE`, or `DELETE` policy exists for any client
  role: no read-back, no listing, no overwrite, no removal.
- R4. The request detail lists the request's documents with their true
  status and, for a client user on an OPEN request with room under the
  cap, one primary control, "Add a document". Absent otherwise (staff, a
  closed request, the cap), never disabled.
- R5. The add-document screen checks locally before sending (type by
  declared MIME with an extension fallback only for a generic
  placeholder, size from the bytes actually read, name sanitized and
  bounded), computes SHA-256 on the phone, and shows every state:
  choosing, checking, checked, sending (three steps), received, refused
  (wording per refusal), failed (sendable again with the same key).
- R6. A privileged scan interface (`begin_document_scan`,
  `record_document_scan`, `expire_stale_document_uploads`) executable by
  the server role only, plus local tooling that runs the named synthetic
  scanner over quarantine and sweeps stale or settled objects.
- R7. Idempotency end to end: the phone makes one UUID per checked
  document; the server returns the same reservation for the same key; a
  replayed reservation that already completed needs no second transfer;
  a duplicate object at the reserved path is a unique violation, never
  an overwrite.

### Non-functional

- N1. Every Milestone 0 and 1 invariant unchanged: RLS everywhere, the
  global staff-AAL2 gate (now also on the transitions and on the storage
  policy), no secrets in the app, synthetic data only, no analytics.
- N2. Local data stays minimal: the picked file's cache copy and its
  bytes live only for the attempt and are discarded on success, refusal,
  reset, and unmount; no offline queue.
- N3. WCAG 2.2 AA on the two changed screens; every status carries a word
  and a glyph, never colour alone; every control has a role and a name;
  the panels are reachable, never collapsed into one string.
- N4. One new dependency, `expo-document-picker` 57.0.2, under the ADR
  rule (ADR 0002); `expo-file-system` and `expo-crypto` were already
  present and gain the read and digest roles.

## 3. Threat deltas

The Milestone 0 threat model (SECURITY.md) stays authoritative; Milestone
2 adds the first client write since sign-in.

- T1. **A client writes where it should not.** Control: the client holds
  no `INSERT`/`UPDATE`/`DELETE` grant on the table; the only writes are
  two functions that verify the caller's `client_user` membership in the
  exact scope, the request's scope, status, and version, every limit,
  and the cap; the bucket admits one `INSERT` at a reserved path. pgTAP
  proves each refusal and each denial; the black-box harness proves them
  over HTTP with real JWTs.
- T2. **Staff upload, or a mixed-role user acts at AAL1.** Control: the
  functions and the storage policy apply the same rule RLS applies to
  every read; staff are refused with 42501 even at AAL2; a mixed-role
  user is refused at AAL1 and passes at AAL2.
- T3. **The quarantine bucket as a read or exfiltration surface.**
  Control: no read, list, update, or delete policy exists; the uploader
  cannot read the object back even a second after writing it; the
  storage service's own guard refuses direct row deletion.
- T4. **A document masquerades: declared one thing, transferred
  another.** Control: `complete` refuses a size mismatch; the scanner
  recomputes the digest over what arrived and rejects a mismatch;
  identity columns are immutable after insert; a finished row is
  immutable entirely.
- T5. **Replay and duplicate reservations.** Control: idempotency key
  unique per request and actor; `(bucket, path)` unique; `upsert` off;
  the cap counts live reservations too.
- T6. **A document's name as an information leak.** Control: the name is
  bounded and printable and appears on the request only; activity events
  carry enumerated kinds and roles (no free text, unchanged); audit
  details carry ids, sizes, and types, never the name; the operator
  tooling prints ids and outcomes only.
- T7. **Stale reservations and quarantine that never empties.** Control:
  a 24-hour transfer window and 30-day retention on the row; the sweep
  expires both and removes settled objects through the storage API.
- T8. **The QA synthetic source ships.** Control: the same three gates as
  every QA hook: the Metro stub outside QA builds, `bundle:inspect`
  proving the marker absent from non-development exports, and
  `config:check` refusing the flag outside development.

## 4. Acceptance tests

- A1. pgTAP suite 008: structure, the denial matrix, every refusal token,
  the cap, the bucket policy (reserved path admitted; unreserved, foreign,
  and duplicate refused; no read-back; delete leaves the object), the
  scan interface (client refused; server role walks a document to a
  verdict; second verdict refused), the sweep, the lifecycle trigger, and
  the request version bump. Suites 001–007 re-run green, with 002
  naming the tenth granted table and 001's membership-scope assertion
  now by natural key.
- A2. Jest: the rules (type, size, name), the flow reducer (every state,
  fail-closed transitions), the hook against fakes (pick, check, digest,
  reserve, transfer, confirm; refusals; retry with the same key;
  discard on success, refusal, reset, unmount), the repository (exact
  scope filters, refusal mapping, the RN body path), both screens (every
  state, the control's presence and absence), the accessibility contract
  over the three new screen states, and the QA source.
- A3. Black-box harness over HTTP with real JWTs: reserve, replay,
  early completion refused, staff refused, foreign write refused,
  unreserved path refused, the object lands, no read-back, no overwrite,
  completion, the trail, the scan interface refused to a client,
  invisibility to another client; the table joins the exact-reach proofs
  for both mixed-role users.
- A4. Live bridge: the shipped composition reads the seeded documents,
  reserves, transfers, confirms, and meets both refusals as typed errors.
- A5. Maestro: `request-add-document.yaml` (the 19th flow) validates; its
  device run is a desktop item for Kody (README, "Milestone 2 on the
  desktop").
- A6. Every static gate green at the candidate: typecheck, lint, format,
  `maestro:validate`, `config:check`, `eas:guard`, `db:types:check`,
  `audit:gate`, `secrets:scan` with Kody's ratification record.

## 5. Decisions made under the standing instruction (provisional)

Listed in `security/APPROVALS.md`, "Provisional decisions". The same
values the 2026-09-18 build chose, kept so nothing Kody already saw
changes under him:

| Decision                           | Value                                                       |
| ---------------------------------- | ----------------------------------------------------------- |
| Per-file size limit                | 20 MB (bucket AND function AND constraint)                  |
| Accepted types                     | PDF, PNG, JPEG, CSV                                         |
| Documents per request              | 10, counting received, checked, and live reservations       |
| Quarantine retention               | 30 days from receipt; transfer window 24 hours              |
| Malware scanning                   | HOLD; `HiveSyntheticScanner` locally (size, digest, marker) |
| The document's name on the request | Shown, bounded to 120 printable characters; nowhere else    |
| What a checked document is         | A HIVE evidence reference; never the permanent record       |

## 6. Dependencies and rollout controls

- D1. `expo-document-picker` 57.0.2 (ADR 0002). No new permission on
  either platform; no iCloud entitlement (the plugin is not configured).
- D2. The Docker stack is the only lane with a storage service, so A3 and
  A4 run there; the binary stack runs everything but the transfer.
- C1. The control is absent, not disabled, wherever a document may not
  be added; the server refuses regardless.
- C2. No document is ever filed, moved, or shown to anyone as evidence
  by this milestone; ACCEPTED means "checked", and the screens say so.
- C3. The scan interface is grant-gated to the server role; a real
  scanner, when approved, speaks to the database only through it.

## 7. Execution record

See the section "Milestone 2 execution record" appended below at the
candidate commit.

## Milestone 2 execution record — 2026-09-28, Kody's desktop

Windows 11, Node 22.23.2, npm 10.9.8, Docker Desktop 4.89 (engine
29.7.2), Supabase CLI 2.115.0, from `118b891` plus the line-ending fix
`e18cdbb`. Three checkpoints, each gated before the next began.

### Before anything: the desktop itself

- **Find 53 — the checkout, not the code.** Git for Windows'
  `core.autocrlf=true` had checked out 306 text files as CRLF, so
  `format:check` failed on 248 files and one node:test (the font-notice
  digest) failed while every committed byte was right. `.gitattributes`
  now pins `eol=lf` for every checkout; committed separately as
  `e18cdbb` so the fix is visible on its own.
- **Docker Desktop would not start:** its backend died in seven seconds
  on a rename of `sailor-ingest.sock` under `%LOCALAPPDATA%\Docker\run`
  ("The file cannot be accessed by the system"): AF_UNIX socket entries
  left by an earlier crash, which neither PowerShell nor .NET could
  delete. Renaming the whole `run` directory aside and starting Docker
  again cleared it in fifteen seconds. Recorded for the next time.
- The local database still held the identities from 2026-09-07, and a
  second `seed` on it always failed with the drift message. **Find 54:**
  the seed verified an EXISTING user from the paged admin listing, which
  on GoTrue v2.195.0 carries no `identities`, so every correctly seeded
  account read as "0 identities". The seed now fetches the single user
  before verifying; a re-run reports "9 verified existing".

### Checkpoint 1 — the schema, the transitions, the bucket, the proofs

Migration `20260928120008_milestone2_document_uploads.sql`: `requests`
gains a version (bumped by trigger on every update) and a composite key;
`activity_events` gains four enumerated document kinds; `document_uploads`
with its lifecycle trigger; `begin_document_upload` and
`complete_document_upload` as security-definer client transitions;
`begin_document_scan`, `record_document_scan`, and
`expire_stale_document_uploads` as caller-privilege server-role
functions; the `hive-quarantine` bucket (private, 20 MB, four types) and
its single INSERT policy. The privilege model was tightened once while
building: the three server functions were first written as definer
functions, which would have made `current_user` the definer inside the
belt-and-brace role check, and on the hosted platform the definer is not
a superuser; as caller-privilege functions the server role's own grants
carry them and the check reads the role the connection runs as.

The first pgTAP run on the CLI stack, ever (the desktop sessions had run
the device lanes; pgTAP had only run on the Linux lanes):

- **Find 56 — suite 001's "membership scope cannot change" passed
  vacuously on this lane.** It updated a membership by the fixed id the
  SQL-only seed uses; the full stack's seed generates ids, so no row
  matched and no exception was raised. Now by natural key (user email,
  entity, role), so it raises on both lanes.
- Suite 002 names the tenth granted table.
- The storage service refuses a direct `DELETE` on `storage.objects`
  with its own guard ("Direct deletion from storage tables is not
  allowed"), which the plain-PostgreSQL shim does not have; suite 008
  swallows the guard and asserts what matters on both lanes, that the
  object remains.

Seed: four settled synthetic documents (`scripts/lib/synthetic-documents.mjs`,
rendered to `supabase/seeds/synthetic-documents.sql` for the SQL-only
lane; a node:test holds the two in lockstep), inserted by `seed-local.mjs`
after the identities they reference. The plain-PostgreSQL shim gained the
`storage` schema as the CLI stack defines it, so the migration and suite
008 run there too (not executed here: that lane needs Linux binaries).

`db-types.mjs` now renders public functions as typed RPC entries and
reaches the database through `docker exec` when no `psql` exists on the
host (the case on this desktop), the query travelling on stdin.

### Checkpoint 2 — the app

`DocumentsRepository` (read plus the three-step upload, refusals as
`UploadRefusedError`, the `ArrayBuffer` body the pinned storage-js
documents for React Native); the rules (type, size from the bytes read,
name); the flow reducer and `useAddDocument` (epoch-dropped late results,
one idempotency key per checked document, discard on success, refusal,
reset, unmount); `RequestDetailView` with the documents section and the
one control; `AddDocumentView` and screen; the route moved to
`app/requests/[id]/index.tsx` beside `add-document.tsx`; the Expo
adapters (`expo-document-picker` 57.0.2 under ADR 0002, `expo-file-system`
`File.bytes()`, `expo-crypto` `digest`); the QA synthetic document source
with its stub, its Metro entry, and its ack; `useScopedLoad` exposes the
bound membership's role.

- **Find 55 — `maestro:validate` crashed on the moved route** (a tracked
  file deleted in the working tree) and had never seen untracked sources
  at all, so a new screen's testIDs were invisible to it until committed.
  It now lists tracked and untracked sources and skips a missing file.
- The 19th flow, `request-add-document.yaml`, arms the synthetic source
  by deep link before walking to the request, because opening the link
  resumes the app at its root.

### Checkpoint 3 — the tooling, the black-box proofs, the records

`scripts/quarantine-scan.mjs` (`scan-quarantine`, `sweep-uploads`) with
`HiveSyntheticScanner` (size, digest, marker; six node:tests); the
black-box harness step 3b (reserve, replay, early completion refused,
staff refused, foreign write refused, unreserved path refused, the object
lands, no read-back, no overwrite, completion, the trail, the scan
interface refused to a client, invisibility to another client) and
`document_uploads` in every exact-reach set; `tests/live/documents-live.test.ts`
through the shipped composition; `local-supabase.mjs bridge`, the live
bridge on the CLI stack (the only lane with a storage service on a
Windows desktop).

- **Find 57 — the CLI-stack bridge met the reviewer's factor from the
  previous run** and waited for an enrollment that never came: this
  stack's database persists between runs where the binary stack's does
  not. The command resets the reviewer's factors through the checked
  loopback command before jest starts.
- The Milestone 1 bridge journey asserted every activity kind matched
  `case.` or `request.`; the vocabulary now has `document.` too.

### Gates at the candidate, all fresh

| Gate                                                    | Result                                                             |
| ------------------------------------------------------- | ------------------------------------------------------------------ |
| typecheck                                               | exit 0                                                             |
| eslint, max-warnings 0                                  | exit 0                                                             |
| prettier, check                                         | exit 0                                                             |
| verify:toolchain                                        | OK                                                                 |
| jest                                                    | **584 passed across 46 suites**                                    |
| test:scripts (node:test)                                | **355 passed, 0 failed, 36 skipped** (device-lane tests) of 391    |
| pgTAP, CLI stack (`supabase test db`)                   | **8 files, 204 asserts, PASS** (suite 008: 84)                     |
| black-box harness, CLI stack (`local-supabase.mjs e2e`) | **177 passed, 0 failed**                                           |
| live bridge, CLI stack (`local-supabase.mjs bridge`)    | **8 passed across 3 suites** (the document journey among them)     |
| maestro:validate                                        | OK — 19 flows, 5 helper scripts                                    |
| db:types:check                                          | committed types match the schema (through the Docker lane)         |
| config:check                                            | OK for profile development                                         |
| eas:guard                                               | OK                                                                 |
| audit:gate                                              | OK — one moderate (`uuid`) below the gate, no waiver on file       |
| secrets:scan, with Kody's ratification record           | OK — 366 tracked files, 956 history blobs, 4 exceptions reconciled |
| export:candidate (inspects its own output)              | OK — 21 text and 65 binary files, zero QA-hook markers             |

### What only the desktop can still prove

The device run in README, "Milestone 2 on the desktop" (seven steps):
the platform picker's cache copy read by the production reader, the
storage policy admitting the phone's real session, and the device digest
matching the scanner's. Owner Kody, no date.

### State

Milestone 2 built and gated on this desktop, committed locally; the
provisional decisions are listed in `security/APPROVALS.md` for one line
from Kody. Not pushed: this machine holds no GitHub credential (no `gh`,
nothing in the credential manager), and only Kody can sign in. The push
is one command from `C:\dev\Lighthouse`, and Git opens the browser
sign-in on first use: `git push -u origin claude/hive-fable-5-greenfield-p0cwkq`.

Next: Milestone 3, review and response (WO-004), on the same standing
instruction, from this candidate.

## Desktop run — 2026-09-28, the seven steps on the emulator

Executed on Kody's desktop from this session rather than waiting for his
hands, under the standing instruction; the full capture is in
`security/evidence/2026-09-28-desktop-m2/`. All seven steps ✅: the stack
re-pointed at the emulator and re-seeded; pgTAP PASS; a clean prebuild
and a QA build (1m 40s); `sign-in.yaml` then `request-add-document.yaml`
green on `Pixel_8` (API 35), ending on "Received, being checked";
`scan-quarantine` accepted the device's document (the phone's
`expo-crypto` digest equal to the scanner's recomputation over the stored
object: the proof the container could not produce); the sweep clean; the
bridge 8 of 8. An ad-hoc flow then read "Checked" beside the document on
glass, and neither "Approved" nor "Filed" anywhere (screenshot in the
evidence folder).

- **Find 58 — the native digest takes a typed array.** The first pass
  through "Choose a file" ended in "Something went wrong": expo-crypto's
  Android `digest` converts its data argument as a `TypedArray` and
  refused the bare `ArrayBuffer` the adapter passed. Fixed in
  `expo-adapters.ts`; pinned by a jest contract test against mocked
  native modules (`expo-adapters.test.ts`, 5 tests), which the unit lane
  had lacked because the adapters were "device only". Localized from the
  failure screenshot and the synthetic PDF's presence in the app cache.
- **Find 59 — the documents section is below the fold.** The flow's
  `assertVisible` on a seeded document name could not see it under the
  request's table; the flow now scrolls each name into view first and
  centres the received document on return.
- Maestro's on-device server segfaulted twice in five runs (transport:
  the app stayed healthy; each re-run passed). Two runbook notes: `expo
run:android --device` wants the AVD name, and a `CI=1` Metro has no
  watcher, so restart it after any edit.

Gates after the two fixes: jest **589 passed across 47 suites**, eslint
0, prettier clean, typecheck 0, `maestro:validate` OK (19 flows).

### State

Milestone 2: built, gated, and run on the device. Committed locally; not
pushed (Kody's sign-in). Provisional decisions still await his one line.
