# Data classification — allowlist and excluded fields

Milestone 0 rule: **synthetic content only**. Clearly fictional labels and
`example.invalid` emails may appear in tests and QA screenshots. Nothing
real or live — identity, entity, filename, document, financial, QBO/Drive,
token, cookie, session, or credential data — may appear anywhere in this
repository, its history, logs, crashes, alerts, notifications, URLs, or
events.

## Source data (database, synthetic seed)

| Class                                             | Examples                                                                                                                                             | Allowed in Milestone 0                                                                                                                                                                              |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scope identifiers                                 | `environment_id`, `client_id`, `entity_id` (UUIDs)                                                                                                   | Yes (synthetic UUIDs)                                                                                                                                                                               |
| Display labels                                    | "Harbor Light Bakery LLC (Synthetic)"                                                                                                                | Yes — clearly fictional, suffixed "Synthetic"                                                                                                                                                       |
| Actor emails                                      | `client.owner@example.invalid`                                                                                                                       | Yes — `example.invalid` only                                                                                                                                                                        |
| Case/workflow status                              | enum values                                                                                                                                          | Yes                                                                                                                                                                                                 |
| Financial values                                  | amounts, balances, account numbers                                                                                                                   | **No — excluded entirely from Milestone 0**                                                                                                                                                         |
| Documents / files                                 | any content or filename from a real system                                                                                                           | **No**                                                                                                                                                                                              |
| Synthetic documents (Milestone 2, WO-003)         | fictional files with "(Synthetic)" in the name; a name-derived digest; the quarantine object of a synthetic transfer                                 | Yes — synthetic only; the name is bounded and printable and appears on its request alone; never in activity events, audit details, logs, or the operator tooling's output                           |
| Synthetic ledger references (Milestone 5, WO-006) | a fictional object's type, identifier, version, "(Synthetic)" label, as-of time, and a digest over fixture text, read by the named synthetic adapter | Yes — synthetic only; never a value (no amount, balance, or account number exists in the shape); the label appears on the staff case review alone, never in activity events, audit details, or logs |
| Synthetic filing receipts (Milestone 5, WO-006)   | a synthetic Drive file id, a "(Synthetic)" folder path, the seeded document's digest as the claim, and the named adapter's verdict                   | Yes — synthetic only; the path appears on the staff case review alone; audit details and the tooling's output carry ids and statuses, never the path or a digest                                    |
| Service status (Milestone 6, WO-007)              | open or paused, a reason code, a minimum app version, a version                                                                                      | Yes — public by design; no user data; read by anyone through one function; changed only by the server role with an append-only history                                                              |
| Deletion requests (Milestone 6, WO-007)           | a request id, the person's user id (null once the account is removed), a pseudonymous subject reference, a status, timestamps                        | Yes — synthetic identities only; own-row reads; never a name or an email; audit details carry the request id and the result                                                                         |
| Real names, real entities, real client data       | —                                                                                                                                                    | **No**                                                                                                                                                                                              |

## Local storage on device

| Store                                | Allowed content                                                                                                      | Excluded                                                                                     |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| SecureStore (Keychain/Keystore)      | The Supabase session envelope (chunked, digest-verified manifest)                                                    | Anything else; no protected records, ever                                                    |
| App documents (install marker)       | `{ installId: random hex, createdAt }`                                                                               | Any identity, scope, or session material                                                     |
| Memory                               | Actor, ScopeKey, memberships, screen data while authorized                                                           | Persisted copies; there is no offline sensitive-write queue and no response cache            |
| App cache (one add-document attempt) | The picked file's copy, made by the system picker, and its bytes in memory, for the duration of one attempt (WO-003) | Anything after the attempt: discarded on success, refusal, reset, and unmount; never a queue |

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
