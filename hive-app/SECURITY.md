# SECURITY.md — HIVE threat model and controls (Milestone 0)

## Assets

1. Client identity and session material (Supabase session tokens on device).
2. Environment / client / legal-entity scope boundaries and memberships.
3. HIVE workflow metadata (case status, attention items, next actions).
4. Append-only audit receipts.
5. The integrity of the release pipeline (no secrets in source, bundles, or history).

Milestone 0 holds **synthetic data only**; the controls are built as if the
data were real.

## Actors

| Actor | Trust |
|---|---|
| Anonymous network client | Untrusted |
| Authenticated client user (AAL1) | Trusted only for exact memberships, read-only |
| Staff roles (intake, preparer, reviewer, approver) | Trusted for role capabilities at AAL2, per membership |
| The mobile app itself | **Untrusted** — it may hold only the Supabase URL and an approved public client key |
| Postgres + RLS + reviewed server functions | The authorization authority |
| Local seed/admin harness (dev machine only) | Privileged; its key never reaches the app |

## Trust boundaries

1. Device ↔ Supabase Auth (identity and session only; no membership authority).
2. Device ↔ Postgres Data API (every row filtered by RLS membership checks).
3. Secure storage ↔ app memory (versioned, digest-verified adapter; quarantine on any doubt).
4. Environment ↔ environment: separate Supabase project and credentials per environment; `environment_id` on every row is defense in depth, not the primary isolation.
5. Client ↔ client and entity ↔ entity inside one environment: RLS membership tuples; composite foreign keys prevent scope mismatch at write time.

Enforcement is Postgres RLS plus reviewed server-side transitions — never UI
state, never client-supplied scope, never `user_metadata` (membership lives
in server-controlled tables).

## Threat cases and required behavior

| Threat | Required behavior | Verified by |
|---|---|---|
| BOLA/IDOR by guessed case ID | Deny before content serialization; zero protected fields returned | pgTAP cross-scope tests |
| Wrong client/entity in route or deep link | Untrusted scope ignored; membership verified server-side; deny | ScopeKey construction rules + repository tests |
| Missing scope tuple in a query or mutation | Type/test failure — repositories require a ScopeKey; DB columns are NOT NULL | TS types + pgTAP constraints |
| Stale membership/JWT | Server rechecks current membership at query time; staff-role rows additionally require an `aal2` JWT claim at RLS (a missing claim counts as aal1) | RLS subqueries + pgTAP staff-AAL suite |
| Client attempts role/boundary change | RLS/grant denial; scope columns immutable by trigger | pgTAP negative tests |
| Duplicate or replayed mutation | (No client mutations exist in M0) — protected-mutation contract: idempotency key, object version, exact scope, server time, atomic audit receipt | Contract recorded; enforced from Milestone 1 |
| Stale object version | Conflict, refresh required, no overwrite | Contract recorded; enforced from Milestone 1 |
| Interrupted sign-out / failed SecureStore deletion | Protected UI removed; `storage_quarantined`; only scrub recovery | Auth machine + controller regression tests |
| Reinstall with iOS Keychain remnant | Pre-auth purge and verification, or quarantine | Install-marker tests |
| Malformed/corrupt session chunks | Quarantine; no partial recovery, no session evaluation | Secure-store adapter tests |
| Late listener after identity switch | Ignored by auth epoch | Controller epoch tests |
| Offline app with prior session | No persistent protected response cache; safe recovery state | Boot tests; no cache layer exists |
| Sensitive value passed to diagnostics | Redaction replaces it; allowlist drops unknown fields | Diagnostics tests |
| Untrusted deep-link input | Route params never become scope; allowlisted navigation only | Tenancy rules + route guard |
| Secret reaches source, history, or bundle | Secret gate (pinned scanner + canary + history scan) and bundle inspection fail the build | scripts/secret-scan.mjs, scripts/bundle-inspect.mjs |

## Controls in Milestone 0

- **Self-registration disabled**; email OTP with `shouldCreateUser: false`; TOTP MFA. AAL2 for staff is enforced twice: the controller routes staff to MFA before scope binding, and RLS itself denies staff-membership rows to any JWT below `aal2` — a first-factor-only staff token gets nothing even by calling the API directly.
- **One Supabase client** behind an auth lifecycle controller with an acquisition freeze, auth epoch, and serialized refresh/sign-out/expiry.
- **Versioned SecureStore adapter**: serialized operations, generation-based two-phase commit for chunked sessions, SHA-256 digest verification, read-back verification of deletions, quarantine on any inconsistency. Keychain accessibility is `WHEN_UNLOCKED_THIS_DEVICE_ONLY` (no cross-device restore).
- **Install marker** outside the Keychain (app documents file, excluded from Android backup via `allowBackup=false`): Keychain material without a marker means reinstall → scrub before any auth construction.
- **RLS everywhere**: every exposed table has RLS enabled, per-operation least-privilege policies using membership subqueries, indexed policy columns, and pgTAP denial tests. Privileged functions live in an unexposed schema with fixed `search_path` and revoked PUBLIC execution.
- **No secrets in the app**: environment validation rejects secret-shaped keys in any variant, including JWT-form service-role keys (the payload role is decoded and only `anon` passes); a legacy anon key is loopback-development-only and release-rejected by `scripts/candidate-config-check.mjs`. The bundle inspector scans the binary Hermes bundles that actually ship (printable-string extraction), not just web text, and pins discovered publishable keys and Supabase endpoints to the approved configuration.
- **Data minimization**: no analytics/crash SDK; diagnostics interface is allowlist + redaction and its default sink is inert; no offline sensitive-write queue; TLS/ATS defaults preserved; Android cleartext stays denied (loopback development traffic is the emulator's own loopback).

## Deliberately not used (per brief)

Root/jailbreak detection, device attestation, certificate pinning,
obfuscation, and biometric local unlock are **not** substitutes for server
authorization and are excluded from Milestone 0. Any future adoption
requires a documented threat decision and recovery design.

## Residual risks (dispositioned)

| Risk | Severity | Disposition |
|---|---|---|
| `image-size` ≤ 2.0.2 DoS advisories (build-time Metro dependency; no fixed release published) | Moderate (build-time only; no confidentiality impact; assets are repo-controlled) | Waiver recorded in `security/waivers.json`, owner Kody, retest at next dependency refresh |
| `uuid` < 11.1.1 bounds-check advisory via `xcode` (prebuild-time) | Moderate, below the high gate | Tracked for next dependency refresh |
| iOS same-device backup restore can restore both marker and this-device-only Keychain items together | Low (same device, same owner; server AAL checks still apply) | Documented; native-lane test when a device lane exists |
| Jest/component tests approximate native accessibility | Low | Native accessibility QA is a device-lane gate before any release candidate |

## Incident stop rules

On any suspected cross-scope disclosure, secret exposure, or storage-
quarantine escape: stop feature work, preserve evidence (do not rewrite
history), report to Kody with the exact reproduction, and do not represent
any affected capability as complete. Kill switches and rollbacks preserve
source records and audit history.

## OWASP MASVS mapping (current release target)

| MASVS family | HIVE control |
|---|---|
| MASVS-STORAGE | SecureStore adapter (digest, quarantine), install marker, no backup of auth material, no sensitive local cache |
| MASVS-CRYPTO | Platform keystore via SecureStore; no home-rolled crypto for secrets (local SHA-256 is integrity-only) |
| MASVS-AUTH | Invite-only OTP, TOTP MFA, AAL2 for staff, server-side membership, auth epoch, serialized lifecycle |
| MASVS-NETWORK | TLS only (loopback dev exception), ATS defaults, no cleartext on Android |
| MASVS-PLATFORM | Expo managed CNG, minimal permissions (none added), predictive back, no exported surfaces |
| MASVS-CODE | Strict TS, lint gate, pinned toolchain, dependency review rule, secret gate |
| MASVS-RESILIENCE | Deliberately deferred (see above) with documented rationale |
| MASVS-PRIVACY | Data classification allowlist, diagnostics redaction, synthetic data only, no analytics SDK |
