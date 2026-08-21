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
   normal-text, env negatives, redaction, SHA-256 vectors, component
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

## Execution record (2026-08-21, this environment)

| Lane | Result |
|---|---|
| npm ci (clean checkout) | exit 0, deterministic from package-lock.json |
| verify:toolchain | exit 0 — Node 22.23.2, npm 10.9.8, Expo 57.0.11, RN 0.86.2, React 19.2.3, expo-doctor 1.20.2, Supabase CLI 2.115.0, supabase-js 2.112.3, TS 6.0.3 |
| npm ls --all | exit 0 |
| npm audit --audit-level=high | exit 1 raw: two high advisories against image-size ≤ 2.0.2 with **no fixed release published**; `npm run audit:gate` exit 0 under recorded waivers (owner Kody, expires 2026-11-21, security/waivers.json) |
| secrets:scan | exit 0 — canary self-test ok, 113 tracked files + 135 history blobs scanned, secretlint clean, allowlist contains only blob-scoped waivers for two historical synthetic test blobs |
| expo-doctor | 19/21; the two failures are network-blocked lookups from this container (Expo config schema fetch, RN Directory) — not project findings. The duplicate-dependency check passes after re-pinning expo-file-system 57.0.5 / expo-secure-store 57.0.1 / expo-build-properties 57.0.13 |
| lint / typecheck | exit 0 / exit 0, zero warnings |
| jest | 17 suites, **220 tests**, all passing (main and clean checkout) |
| node:test script suites | **33 tests**, all passing |
| supabase db reset/lint/advisors/test --local | **HOLD** — container registries (ECR, Docker Hub, ghcr) block blob downloads from this environment, so the CLI stack cannot start |
| db-local fallback (system PostgreSQL 16 + shim) | migrations + seed applied; **53 pgTAP tests** all passing (constraints, grants, full RLS isolation negatives), main and clean checkout |
| db:types:check | exit 0 (generated types match schema) |
| expo export --platform all | exit 0, 11 routes (main and clean checkout) |
| bundle:inspect (development) | exit 0 — 16 text files; only the documented gotrue-js default constant recognized |
| expo prebuild --clean (clean checkout) | exit 0; generated projects verified: `android:allowBackup="false"`, no cleartext traffic, compile/target SDK 36, iOS deploymentTarget 16.4, identifiers com.myhbcfo.hive.development |
| expo run:android --variant debug | **HOLD** — `spawn adb ENOENT` (no Android SDK in this container) |
| expo run:ios | **HOLD** — Linux container ("iOS apps can only be built on macOS devices") |
| Maestro flows | Authored (.maestro/); **HOLD** — no device/simulator lane |
| Device accessibility (VoiceOver/TalkBack, 200% on device) | **HOLD** — device lane; jest accessibility assertions and measured-contrast tests are the executable substitute |

Follow-ups discovered while executing: expo-build-properties (SDK 57 line)
no longer exposes `allowBackup`, so `plugins/with-android-no-backup.js`
sets it directly and the config gate asserts the plugin stays registered.
