# Data classification — allowlist and excluded fields

Milestone 0 rule: **synthetic content only**. Clearly fictional labels and
`example.invalid` emails may appear in tests and QA screenshots. Nothing
real or live — identity, entity, filename, document, financial, QBO/Drive,
token, cookie, session, or credential data — may appear anywhere in this
repository, its history, logs, crashes, alerts, notifications, URLs, or
events.

## Source data (database, synthetic seed)

| Class                                       | Examples                                           | Allowed in Milestone 0                        |
| ------------------------------------------- | -------------------------------------------------- | --------------------------------------------- |
| Scope identifiers                           | `environment_id`, `client_id`, `entity_id` (UUIDs) | Yes (synthetic UUIDs)                         |
| Display labels                              | "Harbor Light Bakery LLC (Synthetic)"              | Yes — clearly fictional, suffixed "Synthetic" |
| Actor emails                                | `client.owner@example.invalid`                     | Yes — `example.invalid` only                  |
| Case/workflow status                        | enum values                                        | Yes                                           |
| Financial values                            | amounts, balances, account numbers                 | **No — excluded entirely from Milestone 0**   |
| Documents / files                           | any content or filename from a real system         | **No**                                        |
| Real names, real entities, real client data | —                                                  | **No**                                        |

## Local storage on device

| Store                           | Allowed content                                                   | Excluded                                                                          |
| ------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| SecureStore (Keychain/Keystore) | The Supabase session envelope (chunked, digest-verified manifest) | Anything else; no protected records, ever                                         |
| App documents (install marker)  | `{ installId: random hex, createdAt }`                            | Any identity, scope, or session material                                          |
| Memory                          | Actor, ScopeKey, memberships, screen data while authorized        | Persisted copies; there is no offline sensitive-write queue and no response cache |

## Logs, diagnostics, crashes, alerts, notifications, URLs, events

Only the allowlist in `src/core/diagnostics.ts` may leave the app:

- **Event names:** `auth_transition`, `auth_illegal_transition`,
  `auth_epoch_stale_event`, `storage_quarantine_entered`,
  `storage_scrub_result`, `storage_write_result`, `reinstall_purge`,
  `scope_cleared`, `env_validation_failed`, `repository_denied`,
  `error_boundary_fatal`.
- **Field names:** `fromState`, `toState`, `event`, `code`, `reason`,
  `outcome`, `count`, `durationMs`, `variant`.
- **Values:** scanned; anything JWT-shaped, key-shaped (`sb_publishable_`,
  `sb_secret_`, `service_role`), UUID-shaped, email-shaped, URL-shaped, or
  PEM-shaped is replaced with `[redacted]`; strings truncate at 64 chars.

Excluded from all telemetry surfaces (tested in
`src/core/__tests__/diagnostics.test.ts`): identity values, emails, scope
UUIDs, entity/client names, filenames, document contents, financial values,
tokens, cookies, session material, credentials, URLs, deep-link payloads.

No analytics or crash SDK exists; adding one requires field-level privacy
approval first.

## Screenshots and fixtures

Same rules as source data: synthetic labels, `example.invalid` emails, no
financial values, no real identifiers. Fixture keys in tests use synthetic
UUIDs and obviously fake values (`sb_publishable_synthetic…`). The secret
scanner's canary values are generated at runtime and never committed.

## Future store disclosures (HOLD — recorded, not answered)

Apple App Privacy and Google Data Safety answers must be rebuilt from the
shipped binary's actual collection at the release-candidate checkpoint.
Milestone 0's truthful baseline: identity (email) and app-functionality
session data processed for authentication; no tracking, no advertising, no
analytics collection, no data sold or shared. Final answers are a HOLD
decision for Kody/Stacie with the completed candidate in hand.
