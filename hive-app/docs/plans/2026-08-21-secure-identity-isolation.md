# Plan — Work Order 001: Secure identity and isolation foundation

**Date:** 2026-08-21. **Owner:** Claude (Fable 5) executing; Kody owns
acceptance. **Gate target:** Milestone 0 with explicit HOLD lanes for
evidence this environment cannot produce (iOS build, Android build,
physical/simulated devices, Maestro runs).

Environment reality recorded up front: this build runs in a Linux cloud
container. Node 22.23.2 was installed exactly (SHA-256-verified from
nodejs.org). Docker is available, so the local Supabase lane is attempted
for real. There is no macOS/Xcode, no Android SDK, no emulator/simulator,
and no Maestro — those lanes report HOLD with everything up to them
completed locally. The parent repository (`krogers-dev/Lighthouse`) already
existed with migration tooling; per the work order, `hive-app/` was created
fresh as the app root inside it and nothing unrelated was touched. The
containing repository is the Git root (a nested repository would detach the
app's history from the mandated branch), and commits land on the designated
branch `claude/hive-fable-5-greenfield-p0cwkq`.

## Checkpoint A — Repository, pinned scaffold, records, env validation, tokens, primitives

Tasks (all committed together as checkpoint A):

1. Resolve create-expo-app once (4.0.0 + integrity), scaffold
   `hive-app/` with `--template default@sdk-57 --no-install --no-agents-md`.
2. Replace every range with exact pins (docs/decisions/0001); remove
   template showcase modules and assets; neutral placeholder images
   (generated solid colors — not a logo).
3. Toolchain enforcement: `.node-version`, `packageManager`, `engines`,
   `devEngines`, `scripts/verify-toolchain.mjs` (`npm run verify:toolchain`).
4. `app.json`: HIVE Dev / `com.myhbcfo.hive.development`, API 36 +
   iOS 16.4 via expo-build-properties, `allowBackup=false`, predictive back,
   Eggshell/Graphite splash, orientation default, typedRoutes.
5. Records: CLAUDE.md, PRODUCT.md, DESIGN.md, SECURITY.md,
   docs/architecture.md, docs/auth-state-machine.md,
   docs/data-classification.md, docs/decisions/0001, this plan,
   `.env.example` (names only).
6. `src/core`: env validation (fail-before-init, never prints values),
   clock, opaque IDs, safe errors, diagnostics allowlist+redaction, SHA-256.
7. `src/ui`: tokens (light/dark), contrast math, primitives (Screen,
   AppText, Button, TextField, StatusBadge, Notice, Loading/Empty/Error/
   Offline/Quarantine states).
8. Tests: contrast table match, every functional pair ≥ AA, rose-never-
   normal-text _(superseded by the Brand Kit v2.0 gold rules — gold
   control text is Soft Black, white-on-gold locked out)_, env negatives,
   redaction, SHA-256 vectors, component
   accessibility. Commands: `npm run lint` (0 warnings), `npm run
typecheck`, `npm test -- --runInBand`.

## Checkpoint B — Auth core

1. `src/auth/epoch.ts` (monotonic epoch gate), `machine.ts` (pure reducer
   per docs/auth-state-machine.md), red-green tests for every transition and
   illegal edge.
2. `src/auth/secure-store-adapter.ts`: serialized ops; chunked two-slot
   generation two-phase commit (write chunks → verify read-back → publish
   manifest {version, generation, chunkCount, byteCount, digest} → clean
   prior slot); quarantine on partial/corrupt/missing/unverifiable; delete
   with read-back verification; bounded scrub of manifest + both slots +
   legacy key.
3. `src/auth/install-marker.ts` (expo-file-system JSON marker; reinstall
   purge rule), `src/auth/client-lifecycle.ts` (single client, freeze/
   dispose), `src/auth/controller.ts` (boot, OTP `shouldCreateUser:false`,
   TOTP MFA, scope load/select, exclusive sign-out sequence, quarantine
   scrub, AppState-driven refresh, serialized queue).
4. Mandatory red-green tests: the sign-out storage-failure regression, epoch
   late-callback, concurrent refresh/sign-out, suspension, expiry, identity
   switch clearing, reinstall residue, biometric invalidation
   (`errSecItemNotFound`-style read rejection), oversized/chunked round
   trips, corrupt digest, missing chunk, deletion rejection, read-back
   mismatch.

## Checkpoint C — Database and dashboard

1. `supabase init` (pinned CLI); config: signup disabled, email OTP on,
   TOTP MFA on; `scripts/local-supabase.mjs` (captured output, redaction,
   0600 `.env.local`, loopback-only legacy-key rule, in-memory service key
   for the seed harness only).
2. Migrations: environments/clients/entities/memberships/cases/
   attention_items/next_actions/audit_receipts; NOT NULL scope triple
   everywhere; composite FKs; immutable-scope trigger; RLS + per-operation
   least-privilege grants; membership policies via `(select auth.uid())`;
   indexed policy columns; privileged functions in unexposed `private`
   schema with fixed `search_path` and revoked PUBLIC.
3. Seed: two synthetic clients × two entities, actors for client user,
   intake, preparer, reviewer, approver, and a no-membership user
   (`example.invalid` emails); pgTAP negatives: anonymous, no-membership,
   wrong-client, wrong-entity, forged ID, membership-insert denial,
   scope-mutation denial, audit access denial, private-function EXECUTE
   denial.
4. `src/data/supabase`: the one client factory, generated
   `database.types.ts` (drift-checked via `npm run db:types:check`), typed
   repositories bound to ScopeKey with defense-in-depth scope filters.
5. `src/tenancy`: membership types, immutable ScopeKey (constructed only
   from server-confirmed memberships), scoped-registry clearing rules,
   chooser view.
6. `src/features/dashboard` + `app/` routes: guarded navigation by auth
   state; dashboard with synthetic status, one attention item, one next
   action, and loading/empty/offline/expired/denied/stale-scope/quarantine
   states; settings with sign-out and account-access info (no deletion
   control — recorded in PRODUCT.md).
7. Commands: `supabase db reset --local`, `db lint --level warning
--fail-on warning`, `db advisors --local`, `test db --local` (pgTAP),
   `npm run db:types:check`.

## Checkpoint D — Verification

1. `scripts/secret-scan.mjs` (secretlint engine + repo patterns + git
   history blob scan + runtime canary self-test + per-profile allowlist),
   `scripts/audit-gate.mjs` (waiver file with owner/reason/expiry),
   `scripts/candidate-config-check.mjs` (release rejects dev identifiers,
   loopback, legacy keys), `scripts/bundle-inspect.mjs` (export scanning),
   with `node --test` unit tests for their pure logic.
2. `.maestro/` flows for sign-in, scope selection, dashboard states,
   sign-out (authored; device lane HOLD here).
3. Full gate run in order; `npx --no-install expo export --platform all`
   after confirming CLI syntax; `npm run bundle:inspect` on the development
   export; clean-checkout drill: fresh `git worktree` → `npm ci` → full
   gates.
4. Independent read-only review pass over the diff; report with gate
   decision, evidence, commands + exit codes + counts, HOLD lanes, and the
   single next task.

## Commit boundaries

One coherent commit per checkpoint (A, B, C, D) on
`claude/hive-fable-5-greenfield-p0cwkq`, pushed after D (and at
intermediate safe points). No advance past a P0/P1 defect, failed isolation
test, secret finding, unresolved destructive migration, or storage-
quarantine escape.

## Execution record — checkpoint D run (2026-08-21, commit `e952fb5`, historical)

_Label added per the PM RETURN directive (P2-12). This table is the
checkpoint-D verification run as it happened; the review-fix run (commit
`b566e05`) totals are in the review record below, and the corrective-
candidate run that supersedes both is recorded in the PM RETURN correction
record at the end of this document._

| Lane                                                      | Result                                                                                                                                                                                                                                                                             |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| npm ci (clean checkout)                                   | exit 0, deterministic from package-lock.json                                                                                                                                                                                                                                       |
| verify:toolchain                                          | exit 0 — Node 22.23.2, npm 10.9.8, Expo 57.0.11, RN 0.86.2, React 19.2.3, expo-doctor 1.20.2, Supabase CLI 2.115.0, supabase-js 2.112.3, TS 6.0.3                                                                                                                                  |
| npm ls --all                                              | exit 0                                                                                                                                                                                                                                                                             |
| npm audit --audit-level=high                              | exit 1 raw: two high advisories against image-size ≤ 2.0.2 with **no fixed release published**; `npm run audit:gate` exit 0 under recorded waivers (owner Kody, expires 2026-11-21, security/waivers.json)                                                                         |
| secrets:scan                                              | exit 0 — canary self-test ok, 113 tracked files + 135 history blobs scanned, secretlint clean, allowlist contains only blob-scoped waivers for two historical synthetic test blobs                                                                                                 |
| expo-doctor                                               | 19/21; the two failures are network-blocked lookups from this container (Expo config schema fetch, RN Directory) — not project findings. The duplicate-dependency check passes after re-pinning expo-file-system 57.0.5 / expo-secure-store 57.0.1 / expo-build-properties 57.0.13 |
| lint / typecheck                                          | exit 0 / exit 0, zero warnings                                                                                                                                                                                                                                                     |
| jest                                                      | 17 suites, **220 tests**, all passing (main and clean checkout)                                                                                                                                                                                                                    |
| node:test script suites                                   | **33 tests**, all passing                                                                                                                                                                                                                                                          |
| supabase db reset/lint/advisors/test --local              | **HOLD** — container registries (ECR, Docker Hub, ghcr) block blob downloads from this environment, so the CLI stack cannot start                                                                                                                                                  |
| db-local fallback (system PostgreSQL 16 + shim)           | migrations + seed applied; **53 pgTAP tests** all passing (constraints, grants, full RLS isolation negatives), main and clean checkout                                                                                                                                             |
| db:types:check                                            | exit 0 (generated types match schema)                                                                                                                                                                                                                                              |
| expo export --platform all                                | exit 0, 11 routes (main and clean checkout)                                                                                                                                                                                                                                        |
| bundle:inspect (development)                              | exit 0 — 16 text files; only the documented gotrue-js default constant recognized                                                                                                                                                                                                  |
| expo prebuild --clean (clean checkout)                    | exit 0; generated projects verified: `android:allowBackup="false"`, no cleartext traffic, compile/target SDK 36, iOS deploymentTarget 16.4, identifiers com.myhbcfo.hive.development                                                                                               |
| expo run:android --variant debug                          | **HOLD** — `spawn adb ENOENT` (no Android SDK in this container)                                                                                                                                                                                                                   |
| expo run:ios                                              | **HOLD** — Linux container ("iOS apps can only be built on macOS devices")                                                                                                                                                                                                         |
| Maestro flows                                             | Authored (.maestro/); **HOLD** — no device/simulator lane                                                                                                                                                                                                                          |
| Device accessibility (VoiceOver/TalkBack, 200% on device) | **HOLD** — device lane; jest accessibility assertions and measured-contrast tests are the executable substitute                                                                                                                                                                    |

Follow-ups discovered while executing: expo-build-properties (SDK 57 line)
no longer exposes `allowBackup`, so `plugins/with-android-no-backup.js`
sets it directly and the config gate asserts the plugin stays registered.

## Independent review record (2026-08-21, fixes landed as commit `b566e05`)

A read-only adversarial review of the full tree ran after checkpoint D.
Result: **0 P0, 2 P1, 8 P2** — all addressed the same day:

| Finding                                                                                | Fix                                                                                                                                                                                                                                                                    |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1-1 staff AAL2 enforced client-side only                                              | Migration `20260821120003_staff_reads_require_aal2.sql`: policies grant through a staff membership only with an `aal2` JWT claim (missing claim = aal1, fail closed); pgTAP suite `004_staff_aal2.test.sql` (10 tests, red first)                                      |
| P1-2 bundle gate skipped binary Hermes payloads; approved-value contract unimplemented | `bundle-inspect.mjs` now string-extracts every binary file (53 in the dev export), pins publishable keys and `*.supabase.co` endpoints to the approved configuration, and documents caret-anchored pattern-source / detector-prefix recognition with tail-length rules |
| P2-1 JWT-form service-role key passed loopback dev                                     | `src/core/base64.ts` decodes the payload role; only `anon` classifies as a client key (env.ts + candidate-config-check)                                                                                                                                                |
| P2-2 repositories bypassed the acquisition freeze                                      | Runtime accessor now also requires the `authorized` state                                                                                                                                                                                                              |
| P2-3 storage bridge had no freeze/epoch gate for late refresh writes                   | Per-bundle `SessionWriteGate` closes permanently on signing_out/quarantine/fatal; doc corrected                                                                                                                                                                        |
| P2-4 partial scrub could evade the residue probes                                      | Scrub deletes probe keys last; adapter test proves an interrupted scrub stays detectable                                                                                                                                                                               |
| P2-5 boot storage failure misclassified as offline                                     | Quarantine errors from the data path route to `STORAGE_FAILURE` before origin mapping                                                                                                                                                                                  |
| P2-6 secretlint bootstrap failures read as findings                                    | Direct `node` invocation of the secretlint binary; empty-report exit 1 → engine failure (exit 2)                                                                                                                                                                       |
| P2-7 cancel legal during OTP verification                                              | Reducer rejects `RETURN_TO_SIGNED_OUT` while verifying                                                                                                                                                                                                                 |
| P2-8 refresh-states doc drift                                                          | Doc names `authorized`/`select_scope` explicitly                                                                                                                                                                                                                       |

Post-fix totals: 233 jest tests (19 suites), 39 script tests, 63 pgTAP
tests, lint 0 warnings, typecheck clean, export + binary-aware bundle
inspection clean.

## PM RETURN correction record (2026-08-21, corrective candidate)

The Project Manager directive of 2026-08-21 returned the milestone to
development. Commit `b566e05` is preserved unchanged as historical
evidence; every correction below landed in a single new corrective commit
on the same branch (no checkpoint-history rewrite).

| Item  | Correction                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0-1  | Versioned `supabase/templates/magic_link.html` renders the six-digit `{{ .Token }}`; `[auth.email.template.magic_link]` registered in config.toml; `scripts/e2e-local-auth.mjs` proves OTP end-to-end black-box (Mailpit token entry, never a link) plus the unknown-email negative (Docker lane)                                                                                                                            |
| P0-2  | Seeds split: `supabase/seed.sql` (domain rows only) vs `supabase/seeds/pgtap-identities.sql` (SQL-only placeholders) vs `scripts/seed-local.mjs` (Auth-Admin-API users from `scripts/lib/synthetic-identities.mjs`); non-ok admin responses verified field-by-field (exact UUID, normalized email, confirmed, exactly one email identity), never accepted by status code alone; e2e proves every account's OTP and JWT `sub` |
| P1-3  | First-time TOTP enrollment via documented `mfa.enroll`: QR (SvgXml) + manual setup key shown memory-only; wrong-code, cancel, retry-setup, relaunch, and subsequent-login tests (machine, controller, views, contract)                                                                                                                                                                                                       |
| P1-4  | Migration `20260821120004_global_staff_aal2_gate.sql`: ANY staff membership ⇒ every protected select requires `aal2`; pgTAP suite 005 (mixed cross-scope and same-scope users, 12 tests) plus retained suite 004 and direct PostgREST negatives in the e2e harness                                                                                                                                                           |
| P1-5  | Refresh is a synchronized function of foreground × auth-state × lifecycle: initialized from `AppState.currentState`, starts on already-active cold boot and on first sign-in, stops on background/sign-out/quarantine/disposal (controller tests)                                                                                                                                                                            |
| P1-6  | `scripts/audit-gate.mjs` rewritten fail-closed (spawn error, signal, exit-code contract, empty output, malformed JSON, schema validation, waiver validation incl. duplicates/expiry/orphans); 14 fake-npm integration tests; raw redacted audit archived in `security/evidence/`                                                                                                                                             |
| P1-7  | Brand Kit v2.0 everywhere: CLAUDE.md amendment, DESIGN.md, tokens, measured-contrast tests (Soft Black on gold 9.56:1; white-on-gold 2.06:1 locked as forbidden), splash/app.json, regenerated placeholder assets; Rose + Slate retained as superseded history; Concept 02 mark still awaits asset QA                                                                                                                        |
| P2-8  | SECURITY.md states precisely: AAL1 staff sees only own membership UUIDs/scope UUIDs/role labels; zero client/workflow content, not even scope names                                                                                                                                                                                                                                                                          |
| P2-9  | `scopeKeyToken` includes `membershipId`; contract test proves a late response from one membership can never render after switching to another membership on the same entity (red first: the stale render reproduced)                                                                                                                                                                                                         |
| P2-10 | Orphaned `c666a92f` jwt-shaped-token exception deleted (it never matched — signature segment under six chars); history-exception gate hardened: full 40-hex blob, exact path, pattern, exact expected count, owner, reason, approval, expiry, retest; unused/duplicate/malformed/expired entries and count drift all fail; tracked files are never allowlisted                                                               |
| P2-11 | `audit:gate` rejects tracked ICNS/JXL/HEIF/HEIC assets while any image-size waiver is active; waiver retest cadence now "monthly, on every lockfile or Expo change, before any release candidate, and at expiry"                                                                                                                                                                                                             |
| P2-12 | ADR 0001 corrected to installed pins (expo-secure-store 57.0.1, expo-file-system 57.0.5, expo-build-properties 57.0.13; react-native-svg 15.15.4 recorded under the dependency rule); execution tables labeled by run                                                                                                                                                                                                        |

Also in this commit: machine-level tests for `MFA_ENROLLMENT_REQUIRED`
legality; Maestro flows for TOTP enrollment/subsequent login, expired
session, offline, quarantine recovery, and reinstall (device lane HOLD)
with a loopback `scripts/totp-helper.mjs`; the WO-002 draft
(`2026-08-21-wo-002-draft-read-only-client-dashboard.md`, labeled DRAFT,
NOT AUTHORIZED TO EXECUTE); and repository-wide Prettier normalization —
`format:check` was failing across 50 files at `b566e05` (the format gate
had drifted out of the run set; it is back in the sweep below).

### Execution record — corrective candidate run (2026-08-21, this environment)

| Lane                                               | Result                                                                                                                                                  |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| verify:toolchain                                   | exit 0 — Node 22.23.2, npm 10.9.8, Expo 57.0.11, RN 0.86.2, React 19.2.3, expo-doctor 1.20.2, Supabase CLI 2.115.0, supabase-js 2.112.3, TS 6.0.3       |
| npm ls --all                                       | exit 0                                                                                                                                                  |
| lint / format:check / typecheck                    | exit 0 / exit 0 / exit 0, zero warnings                                                                                                                 |
| jest                                               | 19 suites, **259 tests**, all passing                                                                                                                   |
| node:test script suites                            | **69 tests**, all passing (incl. 14 fake-npm audit-gate integration, 10 hardened history-exception, 4 RFC 6238 TOTP vectors)                            |
| db-local (PostgreSQL 16.13 + pgTAP 1.3.2 fallback) | reset exit 0; **75 pgTAP tests** in 5 files, all passing                                                                                                |
| db:types:check                                     | exit 0                                                                                                                                                  |
| secrets:scan                                       | exit 0 — self-test ok; 136 tracked files, 184 history blobs; 4 blob exceptions reconciled at exact counts; secretlint clean                             |
| npm audit (raw) / audit:gate                       | exit 1 (two waived image-size highs, one moderate uuid) / exit 0, no prohibited assets                                                                  |
| config:check (development)                         | exit 0                                                                                                                                                  |
| expo-doctor                                        | 19/21 — the same two network-blocked checks (Expo schema fetch, RN Directory) fail from this container; environmental, not project findings             |
| expo export --platform all                         | exit 0, 11 routes                                                                                                                                       |
| bundle:inspect                                     | exit 0 — 16 text + 53 binary files scanned                                                                                                              |
| supabase CLI stack (Docker)                        | **HOLD** — container registries still block blob downloads here; `scripts/e2e-local-auth.mjs` is ready for the pinned stack on a Docker-capable machine |
| iOS/Android builds, devices, Maestro execution     | **HOLD** — device lane owner Kody per the directive                                                                                                     |

Audit-lane status: **HOLD** — waiver entries and the four history
exceptions await Kody's written ratification in the directive's exact
wording; `approvedOn` is not treated as authority.

## Second RETURN correction record (2026-08-21, RETURN-2 corrective candidate)

The second Project Manager directive of 2026-08-21 returned candidate
`e5f06fc` to development; it is preserved unchanged and no hardware lane
was spent on it. All eight areas landed in one new commit — the RETURN-2
corrective candidate, the commit containing this record; its exact hash,
host details, and per-command exit codes are in the resubmission report,
which is the authoritative evidence document for this run.

| Area | Correction                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Every synthetic identity now carries one fixed canonical Auth UUID (`scripts/lib/synthetic-identities.mjs`, identical to the SQL lane's ids). The seed supplies the id to the Admin API, verifies exact UUID, normalized email, confirmation, exactly one email identity, the identity's `user_id` and email (`scripts/lib/auth-verify.mjs`, unit-tested against the exact GoTrue shape), binds memberships to canonical ids, and FAILS on any existing wrong-UUID user. If the stack rejects fixed-ID provisioning the seed stops and prints the exact response verbatim (supported alternative documented: complete SQL provisioning under the canonical id, then Admin-API verification). The e2e harness compares every JWT `sub` against the canonical definitions, never against a live listing |
| 2    | `src/auth/mfa-contract.ts`: `decodeSupabaseTotpQr` decodes/validates the `data:image/svg+xml;utf-8` QR value before `SvgXml` (undecodable → manual key fallback); `splitTotpFactors` derives factors from `listFactors().data.all` filtered by type and status (`data.totp` is verified-only). Cleanup of abandoned unverified factors is fail-stop: a cleanup failure stops enrollment instead of accumulating factors. Contract tests use the exact pinned response shapes; controller tests add repeated cancellation, relaunch, interrupted enrollment, cleanup failure, and factor-limit rejection. QR-scans-successfully evidence is a device-lane item (.maestro/README.md)                                                                                                                    |
| 3    | Migration `20260821120005_restrictive_staff_aal2.sql` separates the staff-AAL2 invariant into `AS RESTRICTIVE` policies on all six protected tables; the permissive scope policies are pure membership checks again. pgTAP suite 006 (11 tests) proves the structure, the unchanged behavior, the own-membership exception, and the bypass regression: an added permissive allow-all policy cannot defeat the AAL1 staff denial (and at AAL2 it visibly widens reach, proving the denial came from the restrictive layer)                                                                                                                                                                                                                                                                             |
| 4    | `scripts/e2e-local-auth.mjs` exercises `mixed.cross` and `mixed.same` with real AAL1 and AAL2 JWTs: at AAL1 zero rows from all six protected tables and exactly the own membership rows (canonical user ids, exact role sets); at AAL2 exact ID-set reach and zero wrong-client/wrong-entity/unrelated rows. SQL impersonation (pgTAP) is never described as live-JWT evidence                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 5    | Mailpit message IDs snapshotted before each OTP request; only a newly observed message with the exact recipient, the exact subject, and exactly one distinct six-digit token is accepted; repeated OTP for the same user tested. Refresh tokens are required (absence fails), refresh runs unconditionally and must yield a new access token, new refresh token, unchanged canonical `sub`, retained `aal2`; the refreshed token drives the protected PostgREST assertions. Controller integration tests cover cold boot, first sign-in, background, resume, sign-out, quarantine, and disposal refresh behavior. `auth.rate_limit.email_sent` raised for the local synthetic lane                                                                                                                    |
| 6    | Waivers match advisory + live-report package + live-report severity (tampering fails); `metadata.vulnerabilities` reconciles against validated per-node schemas; real-calendar-date validation; retest required; approval is a STATE (`proposed`/`ratified`) — proposed entries produce explicit HOLD (exit 3), never approval wording, in both `audit:gate` and `secrets:scan`; prohibited ICNS/JXL/HEIF payloads are detected by file signature as well as extension, keyed to the advisories matched in the live report; new tests cover tampered package/severity, impossible dates, blank retest, inconsistent summary counts, malformed entries, real spawn ENOENT, signals, empty output, malformed JSON                                                                                       |
| 7    | Maestro: wrong-code entry cleared with `eraseText` before the valid code; the wrong code is derived from the real one (never `000000`); the TOTP secret lives only in one loopback helper process's memory across enrollment and login (POST body capture, account-label lookups, clipboard overwritten immediately; strict Base32 validation); the quarantine flow uses a dev-only corruption hook (`hivedev://qa/corrupt-storage`) that release configuration rejects (`config:check`) and bundle inspection proves absent from non-development exports (marker `HIVE_QA_CORRUPT_HOOK`); `npm run maestro:validate` validates all flows (appId, commands, testID selectors, script targets, banned channels)                                                                                        |
| 8    | Scan output distinguishes exception ENTRIES from reconciled MATCHES; the audit gate prints advisory sources vs affected package nodes separately; the six new flows (not five) are listed in .maestro/README.md; Brand Kit v2.0 supersession is annotated inside the retained brief text (SOURCE ORDER and UX AND BRAND) and the last v1-era test name was renamed; Concept 02 artwork and visual QA stay HOLD; WO-002 stays planning-only; repository-split execution still requires an approved runbook                                                                                                                                                                                                                                                                                             |

### Execution record — RETURN-2 corrective candidate run (2026-08-21)

Run in this Linux container at the RETURN-2 corrective candidate (the
commit containing this record; hash and host details in the resubmission
report), plus a full clean-checkout drill at that commit.

| Lane                                               | Result                                                                                                                                                                                                                           |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| verify:toolchain                                   | exit 0 — Node 22.23.2, npm 10.9.8, Expo 57.0.11, RN 0.86.2, React 19.2.3, expo-doctor 1.20.2, Supabase CLI 2.115.0, supabase-js 2.112.3, TS 6.0.3                                                                                |
| npm ls --all                                       | exit 0                                                                                                                                                                                                                           |
| lint / format:check / typecheck                    | exit 0 / exit 0 / exit 0, zero warnings                                                                                                                                                                                          |
| jest                                               | 21 suites, **276 tests**, all passing                                                                                                                                                                                            |
| node:test script suites                            | **104 tests**, all passing                                                                                                                                                                                                       |
| maestro:validate                                   | exit 0 — 10 flows, 2 helper scripts                                                                                                                                                                                              |
| db-local (PostgreSQL 16.13 + pgTAP 1.3.2 fallback) | reset exit 0; **86 pgTAP tests** in 6 files, all passing                                                                                                                                                                         |
| db:types:check                                     | exit 0                                                                                                                                                                                                                           |
| secrets:scan                                       | **exit 3 (HOLD)** — self-test ok; scan itself clean; 4 history-exception entries reconciled covering 5 historical matches; HOLD because the entries are PROPOSED pending Kody's ratification                                     |
| npm audit (raw) / audit:gate                       | raw exit 1 (3 advisory sources across 16 affected package nodes: two waived-proposed image-size highs, one moderate uuid) / **exit 3 (HOLD)** — no failures, no prohibited assets; HOLD because the matched waivers are PROPOSED |
| config:check (development)                         | exit 0 (QA hooks permitted only in development)                                                                                                                                                                                  |
| expo-doctor                                        | 19/21 — the same two network-blocked checks (Expo schema fetch, RN Directory); environmental, not project findings                                                                                                               |
| expo export --platform all / bundle:inspect        | exit 0, 11 routes / exit 0 — 16 text + 53 binary files, QA-hook marker absent semantics enforced for non-development profiles                                                                                                    |
| supabase CLI stack (Docker)                        | **HOLD** — container registries still block blob downloads here; `seed-local` and `e2e-local-auth` are ready for the pinned stack                                                                                                |
| iOS/Android builds, devices, Maestro execution     | **HOLD** — device lane; reservation details are Kody's to supply per the directive                                                                                                                                               |

Audit and exception lanes: **explicitly HOLD (exit 3)** until Kody
ratifies the exact waiver entries and the four history exceptions in
writing; nothing reports them as approved before that.
