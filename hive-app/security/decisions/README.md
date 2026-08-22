# Decision records

A decision record is the immutable artifact that a ratification resolves
to (RETURN-4 P1-6). A repository field written by the implementer is not
authority: `scripts/lib/ratification.mjs` clears HOLD only when the
referenced record exists, its recomputed sha256 equals the entry's
`decisionRecordDigest`, **and** that same digest is presented
out-of-band at verification time through `HIVE_APPROVAL_DIGESTS` — a
channel the implementer does not control.

A record is a JSON object binding every one of:

| Field            | Meaning                                                           |
| ---------------- | ----------------------------------------------------------------- |
| `approver`       | The authorized approver (must be in `AUTHORIZED_APPROVERS`)       |
| `role`           | The role they approve in                                          |
| `action`         | `waiver-ratification` or `history-exception-ratification`         |
| `manifestSha256` | Digest of the exact approved entry set (substance, not approval)  |
| `candidate`      | The commit the approval is given for                              |
| `lockfileSha256` | The lockfile the approval is bound to                             |
| `rawAuditSha256` | The archived raw audit evidence it was judged against             |
| `destination`    | Where the approved artifact may go                                |
| `approvedAt`     | Approval timestamp (its date must equal the entry's `ratifiedOn`) |
| `expires`        | Expiry (must equal the entry's expiry)                            |

Any material change — a different candidate, a changed lockfile, an
edited entry set, a mutated record — invalidates the approval, and the
gate reports it as such rather than passing.

**No decision record exists yet, and none may be fabricated here.** Every
waiver in `security/waivers.json` and every history exception in
`security/secret-scan-allowlist.json` is `proposed`; both gates exit 3
(HOLD). Ratification requires either an artifact signed by Kody or a
digest Kody supplies out-of-band. Claude does not invent a signing key or
an approval.

`integration-fixture-*.json` is a gitignored throwaway written and removed
by `tests/scripts/audit-gate-integration.test.mjs` to exercise the
verified-ratification path end to end; it is never an approval.
