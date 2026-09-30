# WO-012 — onboarding — 2026-09-30

Executed on Kody's Windows desktop from a local Claude session, at the
tree committed with this record, under his standing instruction and his
"move forward" of the day. Staging was changed (one synthetic proof
client and entity, left in place with no member); production was only
read. The project's secret key was read from the Supabase CLI under
Kody's login for each hosted command and written nowhere; the database
password came from his approvals folder into a process environment. This
folder was scanned for both passwords, every key shape, and any run of
twelve to twenty digits: none (the digit runs found are migration stamps
and seeded ids).

| Step | Command                                                                                                    | Result                                                                                                                                                                         |
| ---- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1    | `supabase db reset`, `local-supabase.mjs seed`, `supabase test db`                                         | ✅ migration `20260930120015` applied; **15 files, 551 assertions, PASS** (40 new in suite 015) — `pgtap-local.log`                                                              |
| 2    | `local-supabase.mjs list-entities`, `onboard-entity`, `invite` ×3, `list-access`, `revoke-access` ×3        | ✅ every step as intended, including the refusals (a role outside the five; the same entity twice; a stranger revoked)                                                           |
| 3    | `local-supabase.mjs e2e` (the black-box harness, new step 8)                                               | ✅ **436 checks, 0 failed**; the onboarding lines in `harness-onboarding.log`                                                                                                    |
| 4    | `db push` by connection string to staging, then `supabase test db` there                                   | ✅ the one pending migration applied — `db-push-staging.log`; 15 files, 551 assertions, PASS — `pgtap-staging.log`                                                              |
| 5    | `hosted-supabase.mjs staging` list, onboard, invite (a throwaway; the same again; an existing identity), the outside staff address, list, revoke ×2, list, the duplicate | ✅ as intended; `someone@gmail.com` as intake refused before any key was read; the duplicate refused with `entity_exists` — `operator-onboarding-staging.log` |
| 6    | `hosted-supabase.mjs production list-entities`; `production onboard-entity` without the ref                | ✅ 0 environments, 0 clients, 0 entities; the change refused                                                                                                                    |
| 7    | the throwaway identity removed through the Auth Admin API; staging read as the database owner              | ✅ 0 memberships on the proof entity; receipts by the server role with no address; no proof identity left; 11 users as before — `staging-state.log`                             |
| 8    | `node --test tests/scripts/onboarding.test.mjs` and the whole script suite; lint, format, typecheck, types | ✅ 16 new tests; all gates exit 0                                                                                                                                                |

## What this proves

- An operator can bring a client and a legal entity in and give people
  roles on it, on the local stack and on a hosted project, from this
  desktop, with every change receipted and nothing printed whole.
- The people invited act only through the public endpoints: the client
  reads exactly their scope and cannot grant, onboard, or look anyone up;
  the staff member reads nothing until an authenticator is enrolled.
- A revocation ends access in a session already held.
- A staff role cannot go to an outside address on a hosted project, and
  the same business cannot be onboarded twice.

## What this does not prove

- Anything on production beyond a read: its environment and its first
  client and people are Kody's values.
- A device: nothing in the app changed.
- Sign-in of an invited person on a hosted project: the throwaway
  address cannot receive a code, so the sign-in is proven on the local
  stack, whose mailbox the harness reads.

## Left on staging

`Onboarding Proof Client (Synthetic)` with `Onboarding Proof Entity
(Synthetic)` in the seeded environment, no member, kept for rehearsals.
