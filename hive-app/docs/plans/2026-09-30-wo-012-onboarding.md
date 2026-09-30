# Work Order 012 — Onboarding: a client, an entity, and the people who may see them

**Status: built and proven 2026-09-30 on Kody's desktop under his standing
instruction ("just RUN") and his "move forward" of the same day, as the
first half of Milestone 7. Proven on the local stack and on staging.
Production received nothing: its environment, its first client, and its
first people are Kody's values, brought in with these commands at his
word. Every decision is provisional in `security/APPROVALS.md`.**

**Owner:** Kody (acceptance, security, the values). **Wording:** Stacie.

## 1. Why

Until now only the synthetic seed created an environment, a client, an
entity, or a membership. A hosted project has no seed, so nothing on
production could be given to anyone: the "first invitations" door had no
handle. Membership is the only source of scope authority in HIVE, so the
handle has to be a reviewed server function that writes a receipt, run by
the operator, never a screen in the app.

## 2. Outcome

Five commands in both lanes (`local-supabase.mjs`, and
`hosted-supabase.mjs <staging|production>` with the project ref repeated
for a change on production):

| Command                                          | What it does                                                                                                                                                   |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `onboard-entity "<client name>" "<entity name>"` | brings a legal entity into the lane's environment under a client; the client is found by name or created, the entity must be new; prints the ids               |
| `invite <address> <role> <entity id>`            | gives one person one role on one entity; the person is found by address or created through the Auth Admin API, confirmed, without a password; no email is sent |
| `revoke-access <address> <role> <entity id>`     | removes that one role; every read re-checks membership, so access ends at once                                                                                 |
| `list-entities`                                  | the environments, clients, and entities with their ids                                                                                                         |
| `list-access <entity id>`                        | who holds which role there, addresses masked                                                                                                                   |

Behind them, migration `20260930120015`: `onboard_entity`,
`grant_membership`, `revoke_membership`, and `operator_user_id_by_email`,
runnable by the server role alone, each writing an audit receipt in the
scope it touches, the same idempotency key never writing twice.

## 3. Requirements

- R1. **Server role only.** No client role can execute any of the four
  functions or the helper that reads the identity table; a signed-in
  person who tries is refused like a denied read.
- R2. **One name, one client; one name, one entity of a client.** Names
  are compared without regard to case or spacing and stored trimmed and
  single-spaced; unique indexes hold the rule.
- R3. **An environment is found by name or created with its kind**; a
  name that exists with another kind is refused. Environment names are
  short machine labels; display names are two to 120 printable
  characters on one line.
- R4. **Identities are created through GoTrue, never by SQL** (a row
  inserted by hand is one GoTrue cannot load). An invitation sends no
  email: the person signs in with a code when they open the app, and
  staff enroll an authenticator at their first sign-in.
- R5. **A staff role goes only to an address on the lane's staff
  domains** (`myhbcfo.com` on production); a reserved or test address is
  refused on production for everyone. The rules live in
  `security/hosted-targets.json`, and the code refuses a manifest that
  relaxes production.
- R6. **Receipts carry ids and facts, never a name or an address.**
- R7. **No whole address is ever printed** by the tooling.
- R8. **Every refusal is worded and happens before the key is read**: a
  malformed address, role, name, or id; a change on production without
  the ref.

## 4. Threats and how they are met

| Threat                                                                | Met by                                                                                                          |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| T1. A client grants themselves or another person a membership         | R1; pgTAP 015 (1–8); the harness: the invited client is refused all three functions with their own token        |
| T2. A typo gives a staff role to an outside address                   | R5; unit tests and CLI negatives; the staging run refused `someone@gmail.com` as intake before any key was read |
| T3. A duplicate client or entity splits one business into two records | R2; pgTAP 015 (17–19); the harness and the staging run refused the second onboarding                            |
| T4. A revoked person keeps reading                                    | R4's model: RLS re-checks membership on every read; the harness reads zero rows in the session already held     |
| T5. An operator change leaves no trace, or a lost answer writes twice | Receipts and idempotency; pgTAP 015 (13–16, 30–31); the harness counts the receipts                             |
| T6. Names or addresses leak into receipts, logs, or evidence          | R6, R7; the harness's receipt scan; the evidence folder's scan                                                  |
| T7. A change meant for staging lands on production                    | The runner's target and ref rule (WO-011); the CLI negatives                                                    |

## 5. Decisions recorded (provisional, Kody's to ratify)

| Decision                                   | As built                                                                                                                                         |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Onboarding is an operator action           | Reviewed server-role functions run from the operator's machine; no screen in the app creates a client, an entity, or a membership                |
| The production environment                 | Named `production`, kind `production`, created by the first `onboard-entity` on production at Kody's word                                        |
| Staff addresses                            | Staff roles only on `myhbcfo.com` on production; staging also admits `example.invalid` for rehearsals                                            |
| No invitation email                        | The person is told by Honeybee, outside HIVE, to open the app and enter their address; the code arrives then                                     |
| Names unique per client, per environment   | Case-insensitive; stored trimmed and single-spaced                                                                                               |
| A revocation ends access, not the identity | The identity and its other memberships stay; removing a person entirely is the deletion lane of WO-007                                           |
| The proof entity on staging                | `Onboarding Proof Client (Synthetic)` / `Onboarding Proof Entity (Synthetic)` stays for rehearsals; the harness entity is unique per run locally |

## 6. Proof

- pgTAP `015_onboarding.test.sql`: 40 assertions (grants, onboarding,
  replay, duplicates, name and kind rules, memberships, revocation, the
  lookup), local and staging.
- The harness (`local-supabase.mjs e2e`, step 8): the operator tooling
  onboards and invites; the invited client signs in by emailed code and
  reads exactly their scope; three refusals with their own token; the
  invited staff member reads nothing at AAL1 and their entity at AAL2;
  revocation empties the held session; receipts counted and scanned; the
  run's identities removed.
- Script tests `tests/scripts/onboarding.test.mjs`: the rules, the
  parsing, the masking, the manifest, and the tools' refusals as
  processes with the network replaced by a tripwire.
- Staging through the hosted runner: list, onboard, invite (created and
  existing), the outside staff address refused, list, revoke, the
  duplicate refused; production listed empty and a change refused without
  the ref; staging read back as the database owner.

## 7. Execution record

Runs of 2026-09-30 on Kody's desktop (evidence:
`security/evidence/2026-09-30-desktop-wo-012/`):

| Proof                              | Result                                                                                                                               |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| pgTAP, local (`db reset`, `seed`)  | 15 files, 551 assertions, PASS (40 new)                                                                                              |
| pgTAP, staging, after `db push`    | 15 files, 551 assertions, PASS                                                                                                       |
| The harness                        | 436 checks, 0 failed (36 new)                                                                                                        |
| Script tests                       | 467 in all, 431 passed, 36 skipped by platform, 0 failed (16 new)                                                                    |
| The operator's sequence on staging | every step as intended; the throwaway identity removed afterwards; 0 memberships and receipts without an address read back           |
| Production                         | `list-entities`: 0 environments, 0 clients, 0 entities; a change refused without the ref; the migration not yet pushed (with WO-013) |
