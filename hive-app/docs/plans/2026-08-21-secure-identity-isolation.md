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
| 4    | `scripts/e2e-local-auth.mjs` exercises `mixed.cross` and `mixed.same` with real AAL1 and AAL2 JWTs: at AAL1 zero rows from all six protected tables and exactly the own membership rows (canonical user ids, exact role sets); at AAL2 exact ID-set reach and zero wrong-client/wrong-entity/unrelated rows _[corrected by RETURN-3 area 6: this run asserted exact ID sets for cases/entities/clients only; attention items and next actions gained exact-set assertions and out-of-scope fixtures in the RETURN-3 candidate]_. SQL impersonation (pgTAP) is never described as live-JWT evidence                                                                                                                                                                                                    |
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

## Third RETURN correction record (2026-08-21, RETURN-3 corrective candidate)

The third Project Manager directive of 2026-08-21 returned candidate
`24c375f` to development; it is preserved unchanged and no hardware lane
was spent on it. Accepted areas were not redesigned. All nine areas
landed in one new commit — the RETURN-3 corrective candidate, the commit
containing this record; its exact hash, parent, host details, and
per-command exit codes are in the resubmission report.

| Area | Correction                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | The audit gate no longer deduplicates a GHSA before judging it: every occurrence is collected first, cross-occurrence consistency (one package, one severity, one advisory identity per GHSA) is validated as an engine/schema failure, and each unique advisory is judged once at its worst observed severity. Regressions: moderate-first/high-second, high-first/moderate-second, package-conflict, consistent-duplicate. `metadata.vulnerabilities.total` is now required as a nonnegative integer                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 2    | The signature detector matches the advisory exploit shapes: zero-size `JXL ` boxes (size field ignored), any-size `ftyp` boxes, AVIF-family brands (avif/avis/avci/avcs) and HEIF-family brands including COMPATIBLE brands scanned through the 64-byte head. A positive allowlist now proves every build image has an approved safe extension (.png) AND its exact approved signature — a renamed crafted payload fails, an unapproved image extension fails, unreadable files fail closed. Advisory-derived fixtures added for all shapes                                                                                                                                                                                                                                                                                                                                                                                   |
| 3    | Ratified entries (waivers AND history exceptions) require a named approver (`ratifiedBy` — `owner` is never proof), real ratification date, an approval reference that is rejected if it reads pending/proposed/not approved/not yet given, a decision-record sha256, and (waivers) a `lockfileSha256` binding the approval to the dependency evidence — a ratified waiver bound to a different lockfile digest fails and requires re-approval. All text fields are trim-validated. Negative tests flip the CURRENT proposed entries to ratified without new provenance and prove the gates reject them. Every current entry remains `proposed`; both gates exit 3                                                                                                                                                                                                                                                            |
| 4    | `verifyCanonicalUser` requires `email_confirmed_at` specifically (generic `confirmed_at` can mean phone), exact `role === "authenticated"`, exact `aud === "authenticated"`, and rejects `is_anonymous === true`; phone-confirmed/email-unconfirmed and `service_role` negatives added; all prior checks retained                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 5    | Factor cleanup is fail-closed in a shared unit-tested lib: the listing must succeed and be an array, EVERY deletion must succeed, and a final readback must prove zero factors before enrollment. New checked loopback command `node scripts/local-supabase.mjs reset-totp <synthetic-email>` (synthetic identities only) resets the reviewer before the Maestro enrollment flow, making it repeatable after successful and failed runs. The false claim that seeding clears factors is corrected everywhere                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 6    | Both mixed users' AAL1 evidence now compares COMPLETE canonical membership tuples (user, environment, client, entity, role); AAL2 asserts exact ID sets across ALL SIX protected tables using the refreshed token; out-of-scope attention-item and next-action fixtures (client B / entity B1) added to the seed so those negatives are real; the RETURN-2 record's overstated claim is corrected in place above                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 7    | `bundle:inspect --profile candidate` is the authorized synthetic candidate lane: it scans the ACTUAL production-mode export (text and Hermes binary), requires zero QA-hook markers, refuses to short-circuit (zero files scanned = engine failure, missing dist = engine failure), and `--profile release` is now an explicit exit-3 HOLD. CLI integration tests plant the marker in text and binary payloads and prove detection plus the no-short-circuit contract. **The lane immediately caught a real defect**: Metro registers `require()` dependencies before dead-code elimination, so the `__DEV__`-guarded QA module still shipped in production-mode output. Fixed at the bundler: `metro.config.js` resolves the hook to an inert marker-free stub unless `EXPO_PUBLIC_QA_HOOKS=1` at export time. Executed both directions: QA-flagged export → 3 marker findings, exit 1; clean export → zero findings, exit 0 |
| 8    | Maestro flows are parsed with the real pinned `yaml` parser (2.9.0, recorded under the ADR dependency rule) — malformed YAML, wrong document structure, and fused steps fail; strict canonical Base32 (alphabet, padding amount and position, decoded length, zero unused tail bits) enforced in the helper; the wrong TOTP code is guaranteed to differ from the previous, current, AND next window codes; the quarantine deep link is parsed by exact scheme/host/path (substring attacks proven inert); the corruption hook renders a QA-only completion acknowledgment (`qa-corrupt-ack`) and the flow waits for it before stopping the app; enrollment artifact hygiene is mandatory (restricted temporary `--debug-output`, factor revocation after success or failure via `reset-totp`, scrub before retention, retained evidence starts only after the secret leaves the screen)                                      |
| 9    | Hosted release dependency recorded (PRODUCT.md release dependencies + SECURITY.md residual risks): per Supabase's June 3, 2026 change, new Free-tier default-provider projects cannot customize email templates, so hosted staging/release require Pro or controlled custom SMTP plus black-box proof that the hosted email carries the six-digit `{{ .Token }}` OTP. Release HOLD dependency; the local pinned stack is unaffected                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

### Execution record — RETURN-3 corrective candidate run (2026-08-21)

Run in this Linux container at the RETURN-3 corrective candidate (the
commit containing this record; hash, parent, and host details in the
resubmission report), plus a full clean-checkout drill at that commit.

| Lane                                                                   | Result                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| verify:toolchain                                                       | exit 0 — Node 22.23.2, npm 10.9.8, Expo 57.0.11, RN 0.86.2, React 19.2.3, expo-doctor 1.20.2, Supabase CLI 2.115.0, supabase-js 2.112.3, TS 6.0.3                                                                                                                                                                                         |
| npm ls --all                                                           | exit 0 (now including yaml 2.9.0, dev-only)                                                                                                                                                                                                                                                                                               |
| lint / format:check / typecheck                                        | exit 0 / exit 0 / exit 0, zero warnings                                                                                                                                                                                                                                                                                                   |
| jest                                                                   | 21 suites, **276 tests**, all passing                                                                                                                                                                                                                                                                                                     |
| node:test script suites                                                | **149 tests**, all passing (new: GHSA-consistency and bypass regressions, advisory-derived signature fixtures, positive-allowlist cases, provenance and flip-to-ratified negatives, lockfile-binding, stricter verifier negatives, admin-factor cleanup, bundle-inspect CLI lane, YAML validator, strict Base32, window-safe wrong codes) |
| maestro:validate                                                       | exit 0 — 10 flows, 2 helper scripts, real YAML parse                                                                                                                                                                                                                                                                                      |
| db-local (PostgreSQL 16.13 + pgTAP 1.3.2 fallback)                     | reset exit 0; **86 pgTAP tests** in 6 files, all passing (out-of-scope fixtures added; counts unchanged)                                                                                                                                                                                                                                  |
| db:types:check                                                         | exit 0                                                                                                                                                                                                                                                                                                                                    |
| secrets:scan                                                           | **exit 3 (HOLD)** — scan clean; 4 proposed history-exception entries reconciled covering 5 historical matches                                                                                                                                                                                                                             |
| npm audit (raw) / audit:gate                                           | raw exit 1 / **exit 3 (HOLD)** — occurrence-consistent report, no prohibited assets or signature/positive-allowlist violations; HOLD because the matched waivers are PROPOSED                                                                                                                                                             |
| config:check (development)                                             | exit 0                                                                                                                                                                                                                                                                                                                                    |
| expo-doctor                                                            | 19/21 — same two network-blocked checks; environmental                                                                                                                                                                                                                                                                                    |
| expo export --platform all / bundle:inspect (development)              | exit 0, 11 routes / exit 0 — 16 text + 53 binary files                                                                                                                                                                                                                                                                                    |
| **bundle:inspect:candidate (actual candidate-mode binary inspection)** | clean export: exit 0, zero QA-hook markers across 16 text + 53 binary files. Positive control: an `EXPO_PUBLIC_QA_HOOKS=1` export produced 3 marker findings and exit 1 — the lane detects the marker in real Hermes and web output and the clean export's zero is therefore meaningful                                                   |
| bundle:inspect --profile release                                       | **exit 3 (HOLD)** — requires approved production configuration                                                                                                                                                                                                                                                                            |
| supabase CLI stack (Docker)                                            | **HOLD** — container registries still block blob downloads here; seed, e2e, and reset-totp harnesses ready for the pinned stack                                                                                                                                                                                                           |
| iOS/Android builds, devices, Maestro execution                         | **HOLD** — device lane; reservation details are Kody's to supply                                                                                                                                                                                                                                                                          |

Audit and exception lanes: **explicitly HOLD (exit 3)**. No waiver or
exception is ratified or represented as approved; ratification now
additionally requires the area-3 provenance fields, so a bare status flip
cannot ratify anything.

## RETURN-4 correction record (2026-08-22)

The PM returned candidate `a7fd7f1` with sixteen items. `a7fd7f1` is
preserved unchanged; this record belongs to one new corrective candidate
parented from it. No history was rewritten, nothing was ratified, and no
Docker, native, simulator, device, screenshot, or Maestro execution was
performed.

### Corrections superseding earlier claims

Three earlier statements in this document are now **wrong** and are
corrected here rather than left standing:

1. **Enrollment artifact hygiene (RETURN-3 area 8).** The recorded step
   "run with a restricted temporary `--debug-output`" did not confine
   screenshots. `--debug-output` receives logs and the command journal;
   Maestro writes screenshots — including the failure screenshot that can
   show the enrollment QR and setup key — to `--test-output-dir`, or to
   the default `~/.maestro/tests/<timestamp>` when that flag is absent. The
   hygiene procedure was also prose, not something that runs. Both are
   fixed: `scripts/maestro-enroll-runner.mjs` is now the single supported
   entry point and confines both directories, detects leakage into the
   default location, and cleans up on every exit path.
2. **Hosted OTP email (RETURN-3 area 9).** "Pro or controlled custom SMTP"
   was wrong. A paid plan alone is insufficient: the built-in default
   email service delivers only to project-team addresses and is
   rate-limited, so authorized recipients outside the project team receive
   nothing. Hosted staging/release require a controlled custom SMTP
   provider **or** an approved Send Email Hook. PRODUCT.md and SECURITY.md
   now say so, with the black-box acceptance proof spelled out.
3. **Archived audit evidence.** The archived report predated the current
   lockfile. It is re-captured from a live `npm audit --json` against the
   final lockfile and renamed to a date-free slot
   (`security/evidence/npm-audit-current.json`) with a binding record
   (`.meta.json`: raw-report sha256, lockfile sha256, npm/Node versions,
   capture timestamp, exact counts, advisory list) so a future approval
   binds to this evidence and drift is visible.

### Deviation recorded (P1-5, via-graph cycles)

The directive listed via-graph **cycles** among the structures to reject.
Implemented literally, the gate became unrunnable: the real `npm audit`
report for this lockfile contains legitimate cycles among the metro
packages (`metro` ↔ `metro-config` ↔ `metro-transform-worker`), and the
first implementation reported them as engine failures (exit 2) against
real data. Cycles are therefore **traversed safely** (visited-set worklist,
guaranteed termination) rather than refused, and the security property the
rule protects is enforced directly and strictly: any high or critical node
that resolves to **zero** advisories through its via graph fails, so a
cycle cannot hide an unresolved finding. Both behaviors are unit-tested,
and a further test validates the archived real report through the same
resolver so this class of defect cannot recur silently.

### What each item changed

| Item | Correction                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1-1 | Real e2e `admin()` now returns a normalized `{ok, status, body}`; factor cleanup runs through `requireFactorsClean`, which throws on any contract violation, and the caller terminates immediately (`process.exit(1)`) instead of continuing. Contract tests use the exact real adapter shape (`{status: 200, body: []}` with no `ok` is rejected) and prove no mutation is attempted after a failure. `reset-totp` retained                                                                                                                                                                                                                                                                                                     |
| P1-2 | The refresh check waits deterministically past the prior token's `iat` second (`msUntilIatAdvance`) and then requires a strictly later `iat`, a different access token, a rotated refresh token, preserved `sub`/`session_id`/`aal`, and sane expiry — the same-second flake is gone, with a deterministic regression                                                                                                                                                                                                                                                                                                                                                                                                            |
| P1-3 | `scripts/candidate-export.mjs`: one command resolves approved config (fail-closed), creates a fresh mode-0700 directory, runs the pinned `expo export --platform all` with QA hooks deleted from the child environment, verifies THAT output (metadata-driven per-platform bundles plus payload floors, no hardcoded counts), inspects THAT directory, and records command, tool versions, source commit, config-manifest digest, and a full output manifest. Preplanted, stale, empty, tiny, and platform-missing outputs are all proven unable to pass. The QA-enabled positive control is preserved and itself fails if the detector sees nothing. The lane is labeled synthetic and nonfunctional — never a functional build |
| P1-4 | URLs are parsed and compared as exact origins (`scripts/lib/origins.mjs`); approved configuration comes from an independent manifest (`security/approved-config.json`); missing or partial configuration fails instead of passing; custom Supabase domains require explicit exact-origin approval; vendor constants carry per-file occurrence budgets instead of being deleted globally, and app-owned use of them fails separately. Negatives cover suffix hosts, userinfo, loopback suffixes, malformed ports, missing/partial config, unapproved custom hosts, and app-owned constants                                                                                                                                        |
| P1-5 | Only canonical GitHub advisory URLs yield an id; string vias resolve transitively; dangling references, unresolved high/critical nodes, severity mismatches, and npm-exit-status/report-total disagreement all fail (cycles per the deviation above)                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| P1-6 | Ratification resolves a real immutable decision artifact: recomputed sha256, bound actor/role/action/manifest/candidate/lockfile/raw-audit/destination/time/expiry, material change invalidates, and the digest must ALSO be presented out-of-band (`HIVE_APPROVAL_DIGESTS`) — a repository field is not authority. No signing key and no approval were invented; everything stays `proposed`                                                                                                                                                                                                                                                                                                                                    |
| P1-7 | Governed image extensions now include the Metro defaults that were missing (`.svg`, `.psd`); every non-approved image format is rejected, with svg/psd regressions, and the advisory-shape signature checks are preserved                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| P1-8 | Executable, secret-safe runner (see correction 1) with the deterministic sequence reset → enroll → sign-out → login on the SAME factor → revoke; helper start/termination; clipboard scrub on every exit path; cleanup traps on success, failure, and signals; default-location leak detection; a forced-failure confinement probe; and no retained enrollment-screen artifact                                                                                                                                                                                                                                                                                                                                                   |
| P1-9 | Hosted email corrected (see correction 2); release stays HOLD and nothing is configured                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| P2-1 | Real per-command payload schemas (`tapOn: []`, numeric `inputText`, malformed `extendedWaitUntil`, unknown header/selector fields, bad env types, bad runScript shapes all fail); the Maestro CLI version and artifact checksum are pinned in `security/hardware-toolchain.json`, which the runner enforces before any flow runs                                                                                                                                                                                                                                                                                                                                                                                                 |
| P2-2 | Base32 input is validated as ASCII **before** case folding (U+0131 dotless-i regression)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| P2-3 | The guaranteed-wrong code covers every window reachable in the generation-to-submit interval, carries an expiry, and has a 1 ms-rollover property test                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| P2-4 | Entity B2 now carries its own attention item and next action, so the exact-reach assertion for those tables is a real negative instead of the whole table                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| P2-5 | Canonical identity verification requires exactly one TOTAL identity, the email provider id bound to the canonical user, exact `user_id` and `identity_data.sub`, normalized email, canonical provider metadata, and `is_anonymous === false` stated explicitly; phone/OAuth-extra-identity and mutated-sub negatives added                                                                                                                                                                                                                                                                                                                                                                                                       |
| P2-6 | Audit evidence re-captured and bound (see correction 3)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| P2-7 | History scanning proves completeness: shallow, promisor, and partial clones are refused, and every (blob, path) association is enumerated — the old OID dedup recorded a reused blob under only one path. Temp-repo tests cover a reused blob under two paths and a shallow clone                                                                                                                                                                                                                                                                                                                                                                                                                                                |

### Execution record — RETURN-4 corrective candidate run (2026-08-22)

Run in this Linux container at the RETURN-4 corrective candidate (the
commit containing this record; hash, parent, and host details in the
resubmission report).

| Lane                                                      | Result                                                                                                                                                                            |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| verify:toolchain                                          | exit 0 — Node 22.23.2, npm 10.9.8, Expo 57.0.11, RN 0.86.2, React 19.2.3, Supabase CLI 2.115.0, supabase-js 2.112.3, TS 6.0.3                                                     |
| lint / format:check / typecheck                           | exit 0 / exit 0 / exit 0, zero warnings                                                                                                                                           |
| jest                                                      | 21 suites, **276 tests**, all passing                                                                                                                                             |
| node:test script suites                                   | **238 tests**, all passing (89 more than RETURN-3)                                                                                                                                |
| maestro:validate                                          | exit 0 — **12 flows, 4 helper scripts**, real YAML parse plus per-command payload schemas                                                                                         |
| db-local (PostgreSQL 16.13 + pgTAP 1.3.2)                 | reset exit 0; **86 pgTAP tests** in 6 files, all passing with the new B2 fixtures                                                                                                 |
| db:types:check                                            | exit 0                                                                                                                                                                            |
| secrets:scan                                              | **exit 3 (HOLD)** — 195 tracked files; 348 history blobs across 348 (blob, path) associations, history completeness verified; 4 proposed exceptions covering 5 historical matches |
| npm audit (raw) / audit:gate                              | raw exit 1 / **exit 3 (HOLD)** — 3 distinct advisory sources across 16 affected package nodes; HOLD because the matched waivers are PROPOSED                                      |
| config:check development / release                        | exit 0 / **exit 1** — release names no approved origin in the manifest (HOLD by design)                                                                                           |
| expo export --platform all / bundle:inspect (development) | exit 0 / exit 0 — 16 text + 53 binary files                                                                                                                                       |
| **export:candidate (atomic authorized synthetic lane)**   | exit 0 — fresh mode-0700 directory, QA hooks disabled, platform output verified, inspection clean. **Synthetic nonfunctional configuration; NOT a functional build**              |
| **export:candidate --qa-control**                         | exit 0 as a control — the QA-enabled export was REJECTED by inspection with qa-hook findings in the real iOS `.hbc`, Android `.hbc`, and web bundle                               |
| bundle:inspect --profile release                          | **exit 3 (HOLD)** — requires approved production configuration                                                                                                                    |
| expo-doctor                                               | 19/21 — the same two checks fail on blocked egress (`Host not in...` from the proxy); environmental                                                                               |
| supabase CLI stack (Docker)                               | **HOLD** — no Docker in this container                                                                                                                                            |
| iOS/Android builds, devices, Maestro execution            | **HOLD** — device lane; no device, simulator, or Maestro binary here. `maestro:enroll` correctly exits 3 (HOLD)                                                                   |

Audit and exception lanes remain **explicitly HOLD (exit 3)**. Nothing is
ratified; the Maestro CLI pin is an operator-fill HOLD because outbound
HTTPS to the release host is denied by organization egress policy here and
no checksum may be invented.
