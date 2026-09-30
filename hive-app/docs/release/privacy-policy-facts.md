# Privacy policy: the facts about HIVE (prepared 2026-09-29)

**Status: a fact sheet for whoever writes the privacy policy (Kody and
Stacie, with counsel if they choose). On 2026-09-29 Kody instructed a
default policy to be drafted from it: `privacy-policy.md`, published at his
instruction with his entity and address. This sheet is not the policy; it lists what the app does, from the reconciled disclosure
(`privacy-disclosures.json`, checked against the code by
`privacy:reconcile`).** Every statement below is proven by a gate, a
migration, or a test named beside it.

| Fact                                                                                                                                                                | Proof                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Accounts are created by invitation only; the app cannot create one                                                                                                  | `enable_signup = false`; the app requests codes with `shouldCreateUser: false` |
| Sign-in is by a one-time code sent to the person's email; staff also use an authenticator                                                                           | the auth machine; the MFA contract tests                                       |
| Personal data held: the sign-in email, the account id, and the content a client provides (documents and answers)                                                    | `privacy-disclosures.json`; `docs/data-classification.md`                      |
| No financial values (amounts, balances, account numbers) exist in the app's data                                                                                    | the data classification; `privacy:reconcile`                                   |
| No tracking, no advertising identifier, no analytics or crash SDK                                                                                                   | `privacy:reconcile` (dependency denylist, manifest)                            |
| Data travels only to the configured service origin over TLS                                                                                                         | `privacy:reconcile` (no host literal); `env.ts` (https only)                   |
| Sign-in code emails are delivered by Resend from `hive@myhbcfo.com` (chosen 2026-09-29); the provider sees the recipient address and the code, never client content | `docs/release/hosted-project-setup.md` §3                                      |
| On the device, only the session is stored, in the platform's secure store; nothing else persists                                                                    | the secure-store adapter and its tests                                         |
| A person can request account deletion in the app and withdraw it until completed                                                                                    | `request_account_deletion`; pgTAP 012; the device flow                         |
| Deletion removes access and the sign-in account; business records are kept under the firm's policy, with who acted as an internal reference                         | migration 20260928120012; pgTAP 012 (46, 47)                                   |
| Every sensitive action writes an audit receipt that names ids, never content                                                                                        | `app_private.append_audit`; the suites                                         |
| The service can be paused; pausing removes nothing                                                                                                                  | the kill switch; pgTAP 012                                                     |

What the policy must add that no gate can supply: the legal basis for
processing, the retention periods under Honeybee's record-keeping
policy, the controller's identity and contact, the jurisdictions, and
the rights and the way to exercise them.
