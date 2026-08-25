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

## Current state

**Nothing is ratified.** Every waiver (2) and history exception (4) is
`proposed`; `audit:gate` and `secrets:scan` both exit 3 (HOLD). No signing key
and no approval is invented here — clearing HOLD requires Kody's decision
record, supplied out-of-band after the child commit exists.
