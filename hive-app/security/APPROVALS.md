# Approval and ratification model

**Approval material never lives in this repository.**

An entry in `security/waivers.json` or `security/secret-scan-allowlist.json`
that says it is ratified proves nothing on its own — the implementer writes
that field. Earlier revisions required a decision record committed under
`security/decisions/`, which was also insufficient for a structural reason:
**a record committed inside a commit cannot name that commit's own hash**, so
an in-repo record can only ever bind some earlier commit. Under the RETURN-5
ruling the record moved out of the repository entirely, and
`security/decisions/` no longer exists.

## The flow

1. The corrective child commit is built and pushed with every waiver and
   history exception still `proposed`. Both gates exit 3 (HOLD).
2. The approver issues a decision record **naming that child's SHA**, which
   now exists. Nothing about the approval is committed.
3. Verification runs at the child with the record and its digest supplied
   through channels the implementer does not control:

   ```
   HIVE_APPROVAL_RECORDS=/path/outside/the/repo/waivers-approval.json
   HIVE_APPROVAL_DIGESTS=<sha256 of that file>
   npm run audit:gate
   npm run secrets:scan
   ```

Both are required. Handing the gate a file is not an approval, and stating a
digest without the record is not one either.

## What a decision record contains

A JSON object binding every one of:

| Field            | Meaning                                                          |
| ---------------- | ---------------------------------------------------------------- |
| `approver`       | The authorized approver (must be in `AUTHORIZED_APPROVERS`)      |
| `role`           | The role they approve in                                         |
| `action`         | `waiver-ratification` or `history-exception-ratification`        |
| `manifestSha256` | Digest of the exact approved entry set (substance, not approval) |
| `candidate`      | The commit approved — the child SHA, which exists by now         |
| `lockfileSha256` | The lockfile the approval is bound to                            |
| `rawAuditSha256` | The archived raw audit evidence it was judged against            |
| `destination`    | Where the approved artifact may go                               |
| `approvedAt`     | Approval timestamp; its date must equal the entry's `ratifiedOn` |
| `expires`        | Expiry; must equal the entry's expiry                            |

The entry itself carries `decisionRecordDigest` and **no path**: it must not
be able to point at material the implementer controls. A surviving
`decisionRecordPath` field is refused.

## What is refused

- A decision record located **inside the repository** — refused by the
  loader before it is read, so committing one can never help.
- A record supplied without its digest stated independently, or a digest
  stated without the record.
- An unauthorized approver, however internally consistent the record.
- A record whose digest does not match, or that was edited after approval.
- An approval naming a different candidate, manifest, lockfile, or raw-audit
  archive — any material change invalidates it.
- A ratification dated in the future, or after the entry's expiry.

## Provisional decisions awaiting Kody's one-line ratification

Under Kody's standing instruction of 2026-09-18 ("just RUN"), each
milestone records the product decisions it had to make. None is a HOLD
item; each is reversible by changing one value and re-running the gates.
A one-line reply ("I ratify the Milestone 2 decisions" or "change X to Y")
settles them. Until then they stand as built.

### Milestone 2 — controlled document request (WO-003, 2026-09-28)

| Decision                   | As built                                                                                                     | Where it lives                                                                                                 |
| -------------------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Per-file size limit        | 20 MB                                                                                                        | bucket `file_size_limit`; `begin_document_upload`; the table constraint; `DOCUMENT_LIMITS.maxBytes`            |
| Accepted types             | PDF, PNG, JPEG, CSV                                                                                          | bucket `allowed_mime_types`; the function; the constraint; `ALLOWED_MIME_TYPES`                                |
| Documents per request      | 10, counting received, checked, and live reservations; refused and expired do not count                      | `begin_document_upload`; `DOCUMENT_LIMITS.maxPerRequest`                                                       |
| Quarantine retention       | 30 days from receipt; a transfer window of 24 hours before it                                                | `complete_document_upload`; `begin_document_upload`; the sweep                                                 |
| Malware scanning           | **HOLD** for a real scanner. Locally, `HiveSyntheticScanner` recomputes size and digest and refuses a marker | `scripts/lib/synthetic-scanner.mjs`; the server-role scan interface is what any approved scanner will speak to |
| The document's name        | Shown on its request, bounded to 120 printable characters, never in activity, audit details, or logs         | the constraint; `sanitizeDisplayName`                                                                          |
| What a checked document is | A HIVE evidence reference: "Checked", never approved, filed, or final; Drive stays the record, filing manual | `DOCUMENT_STATUS_PRESENTATION`; PRODUCT.md                                                                     |
| Who uploads                | Client users only, on OPEN requests; staff never (the control is absent and the server refuses)              | `client_user_for_scope`; the storage policy; `canAddDocumentTo`                                                |

### Milestone 3 — review and response (WO-004, 2026-09-28)

| Decision                     | As built                                                                                                                                                                                        | Where it lives                                                     |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Answer length                | 4,000 characters; newline and tab allowed, other control characters removed on the phone and refused by the server                                                                              | the table constraint; `save_request_answer_draft`; `ANSWER_LIMITS` |
| What can be cited            | Up to 20 documents, only ones received on the same request (received, being checked, or checked); a citation that is refused or expired before submission refuses the submission                | `citable_document_count`; both functions; `citableDocuments`       |
| One answer per request       | A single record, DRAFT until submitted, then immutable in text, citations, and status; another client user of the workspace cannot take over a draft (answer_changed)                           | `unique (request_id)`; the lifecycle trigger; the draft function   |
| Where the draft lives        | On the server with the request, never on the device; the writer sees it from any device; staff never see a draft                                                                                | `request_answers_select_by_membership`                             |
| What a submission moves      | The request to ANSWERED, one "request answered" activity entry, and an audit receipt carrying lengths and counts, never the text; the case, its attention item, and its next action do not move | `submit_request_answer`; pgTAP suite 009                           |
| Who reads a submitted answer | Client users of the scope; staff of the scope at AAL2 only                                                                                                                                      | the permissive and restrictive policies on both tables             |
| Blank drafts                 | A blank draft can be saved (a person may clear and come back); it cannot be submitted (empty_answer)                                                                                            | `submit_request_answer`; `checkAnswerText`                         |
| The primary action           | On an open request a client user's primary control is "Answer this request"; "Add a document" stands beside it as the secondary control                                                         | `RequestDetailView`                                                |
| The source link              | Seeded only; no client or staff path sets which document a request is about; resolved by its own scoped read, so a link outside the scope could never render a name                             | `requests.subject_document_id`; `loadRequestContext`               |
| Telling Honeybee             | **HOLD**: how Honeybee learns of a submission is a communication contract for Stacie; nothing here notifies anyone                                                                              | the migration header; PRODUCT.md                                   |
| Wording                      | Placeholder client wording for every refusal, state, and the confirmation, Stacie's to replace wholesale                                                                                        | `ANSWER_REFUSAL_WORDING`; the answer view                          |

## Current state

**Ratified.** On 2026-09-07 Kody ratified the four history exceptions in
`security/secret-scan-allowlist.json` in writing ("I ratify the four proposed
history exceptions in security/secret-scan-allowlist.json."). The decision
record was drafted at candidate `986d5a35c2190fc580b9b92d0e77a9d5055f9c02`
(manifest `2f5a5a306e79d72dadd5a333d5e6c53cf63e9d22c3d62560f7c0140bcdaaae4b`,
four entries, shared expiry 2026-11-21), its digest is
`b374a22273b651d1378e14ab2a8b7b47baeb3c706ac0a1b723ac1764db7f66f9`, and the
provenance was applied to the entries in the commit after that candidate. The
record itself lives OUTSIDE this repository, in Kody's custody, and is never
committed; `secrets:scan` exits 0 only when it is supplied out-of-band:

    HIVE_CANDIDATE_SHA=986d5a35c2190fc580b9b92d0e77a9d5055f9c02 HIVE_APPROVAL_RECORDS=<path to the record> HIVE_APPROVAL_DIGESTS=b374a22273b651d1378e14ab2a8b7b47baeb3c706ac0a1b723ac1764db7f66f9 npm run secrets:scan

Without it the gate FAILS (exit 1, "an entry claiming ratification proves nothing on
its own") — a ratification cannot be replayed from repository contents alone. The
exceptions expire on 2026-11-21; after that
date the gate returns to HOLD until the history is rewritten or a new record is
ratified. The two audit waivers were retired on 2026-09-06 by their own recorded
removal condition — the SDK 57 patch refresh dropped `image-size` from the
dependency tree, so neither advisory exists to waive (history preserved in
`security/waivers.json` `$history`); with no waiver on file and only
below-gate moderates in the audit, `audit:gate` exits 0. No signing key and no
approval is invented here.
