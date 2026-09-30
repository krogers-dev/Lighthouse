# WO-015 — the malware scanner (ClamAV) — 2026-09-30

Executed on Kody's Windows desktop from a local Claude session, at the
tree committed with this record, under his standing instruction and his
decision of the day on the scanner ("use your recommendation"). Docker
stack (Supabase CLI 2.115.0), Docker Desktop for the ClamAV container,
Node 22.23.2. Both hosted projects received migration 017 (the receipts
name the scanner); no hosted project was scanned: the host is Kody's
door. The database passwords came from his approvals folder into a
process environment and appear in no log; the hosted commands read the
project secret key from the Supabase CLI login for one command each and
printed none of it. The EICAR test file is assembled at run time by the
proof and appears in no file here.

| Step | Command                                                                                  | Result                                                                                                                                       |
| ---- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `docker pull clamav/clamav:1.4`, `docker run … -p 127.0.0.1:3310:3310`                   | ✅ the image by digest, clamd up, signatures 28136 (28139 after freshclam ran inside it) — `images.log`                                        |
| 2    | `supabase db reset`, `local-supabase.mjs seed`, `supabase test db`                       | ✅ migration `20260930120017` applied; **17 files, 615 assertions, PASS** (10 new in suite 017) — `pgtap-local.log`                            |
| 3    | `local-supabase.mjs prove-scanner`                                                       | ✅ **15 passed, 0 failed**: clean accepted, EICAR rejected as malware with its signature named, receipts naming ClamAV and the signature version, the sweep, an outage that holds, two refusals — `scanner-proof-local.log` |
| 4    | `docker build -f deploy/scanner/Dockerfile -t hive-scanner-runner .` and two runs of it  | ✅ 238 MB, user `node`; a legacy key on a hosted origin refused (exit 2); clamd unreachable holds (exit 3) — `images.log`                      |
| 5    | `db push` by connection string to staging and production, `supabase test db` on staging | ✅ the one pending migration applied on both — `db-push-staging.log`, `db-push-production.log`; 17 files, 615 assertions, PASS — `pgtap-staging.log` |
| 6    | `hosted-supabase.mjs staging quarantine-status`, `staging sweep-uploads`, `production quarantine-status`, `production sweep-uploads` without the ref | ✅ counts only; 0 removed on staging; production 0 everywhere; the change refused without the ref — `operator-quarantine.log` |
| 7    | `db:types:check` against the local stack and against production                          | ✅ the committed types match both                                                                                                             |

## What this proves

- A real engine judges real bytes through the reviewed interface, and
  the permanent record says which engine and which signatures.
- The runner cannot be pointed anywhere but the two projects, cannot
  use a legacy key, holds rather than rejects when the engine is away,
  and prints no document name, digest, or key.

## What this does not prove

- Scanning on a hosted project: no host exists yet
  (`docs/release/scanner-deployment.md`, steps 1–3 are Kody's).
- The runner's long-running loop over days: proven for one pass and
  for a pass with the engine down; the loop is the same pass on a timer.
