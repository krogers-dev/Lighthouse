# ADR 0001 — Mobile foundation: pinned stack

**Status:** Accepted (Work Order 001). **Owner:** Kody (capability decisions).

## Decision

Expo managed workflow with Continuous Native Generation, Expo Router, React
Native, strict TypeScript, npm with exact pins and a single lockfile, and
development builds (not Expo Go) for QA. Supabase (Auth + Postgres/RLS) as
the backend, driven locally through the pinned CLI.

## Pinned versions (verified against the npm registry 2026-08-21)

| Component             | Version                                                                                                             | Why this exact pin                                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Node                  | 22.23.2 (`.node-version`, `engines`, `devEngines`)                                                                  | Brief-verified baseline; downloaded from nodejs.org with SHA-256 verification                                                  |
| npm                   | 10.9.8 (`packageManager`)                                                                                           | The npm bundled with that exact Node distribution                                                                              |
| create-expo-app       | 4.0.0 (integrity `sha512-bZX0CuE6ZdJWKZUtJRnZYt6t1tbU6o/tHjffhZTJnpR2no+GncxQ2Okvc4+AyCBMx4Za2G85szrbAicgo4Qz9w==`) | Resolved once from npm metadata; run as `create-expo-app@4.0.0 hive-app --template default@sdk-57 --no-install --no-agents-md` |
| expo                  | 57.0.11                                                                                                             | Brief-verified baseline (template generated `~57.0.15`; the verified 57.0.11 pin was kept deliberately)                        |
| react-native          | 0.86.2                                                                                                              | Brief-verified baseline                                                                                                        |
| react / react-dom     | 19.2.3                                                                                                              | Brief-verified baseline; react-dom matches react                                                                               |
| @supabase/supabase-js | 2.112.3                                                                                                             | Brief-verified baseline                                                                                                        |
| supabase (CLI)        | 2.115.0 (exact dev dependency)                                                                                      | Brief-verified baseline; invoked via `npx --no-install`                                                                        |
| expo-doctor           | 1.20.2 (exact dev dependency)                                                                                       | Current stable at pin time                                                                                                     |
| typescript            | 6.0.3                                                                                                               | Template's line, pinned exact                                                                                                  |

Remaining dependencies are the SDK 57 template's own set resolved to exact
versions inside the template's ranges, plus the additions below. All ranges
were replaced with exact pins; `package-lock.json` is the single lockfile
and `npm ci` is the only install path after the initial resolution.

## Additions beyond the template (dependency rule applied)

_Corrected 2026-08-21 (PM RETURN directive P2-12): the first three rows
originally recorded pre-SDK-57-renumbering versions (15.0.8 / 19.0.24 /
1.0.10) noted during initial resolution; the pins actually installed and
verified by `expo-doctor` are the SDK 57 renumbered releases below. The
`react-native-svg` row was added when TOTP enrollment (P1-3) landed._

| Dependency                                                                                         | Outcome it serves                                                                                      | Why nothing installed suffices                                                                       | Native surface added                                                                                                                                                                                                             |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| expo-secure-store 57.0.1                                                                           | Session material in Keychain/Keystore                                                                  | RN core has no secure storage                                                                        | Keychain/Keystore usage (config plugin, no new permissions)                                                                                                                                                                      |
| expo-file-system 57.0.5                                                                            | Non-sensitive install marker outside the Keychain                                                      | SecureStore must not hold the marker (its purpose is to _not_ survive with the Keychain)             | App-scoped storage only                                                                                                                                                                                                          |
| expo-build-properties 57.0.13                                                                      | Pin iOS deployment target 16.4, Android target/compile SDK 36                                          | app.json alone cannot set these                                                                      | None (build-time config plugin). This release dropped its `allowBackup` switch, so `android:allowBackup="false"` is forced by the repo-local plugin `plugins/with-android-no-backup.js`, verified against the generated manifest |
| react-native-svg 15.15.4                                                                           | Renders the TOTP enrollment QR (`SvgXml`) from supabase-js's inline SVG — memory-only, never persisted | No installed dependency renders SVG; a raster fallback would require writing the otpauth URI to disk | SVG rendering view (SDK 57's bundled native module version; no new permissions)                                                                                                                                                  |
| @supabase/supabase-js 2.112.3                                                                      | Auth + PostgREST client                                                                                | —                                                                                                    | None (JS)                                                                                                                                                                                                                        |
| jest 29.7.0, jest-expo 57.0.4, @testing-library/react-native 14.0.1, @types/jest 29.5.14           | Red-green unit/component tests                                                                         | —                                                                                                    | Dev-only                                                                                                                                                                                                                         |
| eslint 9.39.5, eslint-config-expo 57.0.1, eslint-import-resolver-typescript 3.10.1, prettier 3.9.6 | Lint/format gates                                                                                      | —                                                                                                    | Dev-only                                                                                                                                                                                                                         |
| secretlint 13.0.4 + preset-recommend 13.0.4                                                        | Pinned, checksum-verified (npm lockfile SSRI integrity) secret scanner engine inside the secret gate   | Home-rolled patterns alone are weaker; a downloaded binary would bypass lockfile verification        | Dev-only                                                                                                                                                                                                                         |
| supabase 2.115.0                                                                                   | Local database stack, migrations, pgTAP, type generation                                               | —                                                                                                    | Dev-only                                                                                                                                                                                                                         |

## Rejected alternatives

- **expo template extras removed** (`@expo/ui`, `expo-glass-effect`,
  `expo-image`, `expo-symbols`, `expo-web-browser`, `expo-device`,
  `expo-font`): showcase/UI-framework surface; Milestone 0 excludes UI
  frameworks, brand assets are HOLD (no custom fonts), and each removal
  shrinks the native/store-disclosure surface. `react-native-gesture-handler`,
  `react-native-reanimated`, and `react-native-worklets` stay because
  `expo-router` declares them as peer dependencies (navigation
  infrastructure, not a styling framework).
- **ESLint 10.8.1** (latest): rejected after verification — bundled
  `eslint-plugin-react` still calls `context.getFilename`, removed in
  ESLint 10. Pinned 9.39.5 (the line eslint-config-expo 57 targets).
- **jest 30**: rejected; jest-expo 57 is built on jest 29 internals
  (`babel-jest ^29`, `jest-snapshot ^29`).
- **Expo Go for QA**: forbidden by the brief; development builds only.
- **yarn/pnpm/bun**: brief mandates npm with one lockfile.
- **AsyncStorage for sessions**: rejected; sessions live only in the
  versioned SecureStore adapter.
- **react-native-url-polyfill**: not added; RN 0.86/Hermes provides the URL
  surface supabase-js 2.112 needs (verified by unit tests and export).
- **State/styling/UI frameworks, Realtime, notifications, analytics, OCR,
  response caching, certificate pinning, EAS Update**: excluded from
  Milestone 0 by the brief.
- **React Compiler experiment**: the template enables
  `experiments.reactCompiler`; removed for Milestone 0 — an experimental
  compiler is not a dependable-baseline component. `typedRoutes` stays.
- **gitleaks binary download in the secret gate**: rejected — a runtime
  binary download cannot be integrity-pinned by the lockfile and breaks
  clean-checkout determinism offline. secretlint (lockfile-verified) plus
  repo-local pattern and history scanning covers the gate; revisit when a
  vetted binary distribution channel exists.

## Known advisory disposition at pin time

`npm audit` reports two high advisories against `image-size` ≤ 2.0.2
(build-time Metro dependency; DoS-only) with **no fixed version published**,
and one moderate against `uuid` < 11.1.1 via `xcode` (prebuild-time).
Waivered with owner/expiry in `security/waivers.json`; the audit gate
(`scripts/audit-gate.mjs`) enforces waiver expiry so the finding resurfaces.
