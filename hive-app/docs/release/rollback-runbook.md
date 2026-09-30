# Rollback and kill-switch runbook (WO-007, prepared 2026-09-28)

**Status: prepared and drilled on the local synthetic stack. Every step
that touches a store account, a hosted project, or a real device fleet is
HOLD until Kody names the exact build, destination, and account.** The
brief's rule stands throughout: kill switches preserve source records and
audit history. Nothing here deletes, moves, or rewrites a record.

## The three levers, in the order to reach for them

| Lever                            | What it does                                                                                                                                                                                                                 | Who acts              | Proven by                                                                                           |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------- |
| 1. Pause the service             | Every client and staff read returns zero rows and every reviewed transition is refused (`service_paused`) until resumed. The app shows "HIVE is paused" with the reason. Nothing is removed.                                 | server role           | pgTAP 012 (assertions 14 to 29), harness step 4d, `service-paused.yaml` on the device               |
| 2. Raise the minimum app version | An app below the minimum shows "Update HIVE to continue" and nothing else; newer builds proceed.                                                                                                                             | server role           | jest (`service-status`, `service-gate`), pgTAP 012 (32)                                             |
| 3. Roll the binary back          | The stores serve the previous build again (Apple: halt the phased release or remove the version from sale and resubmit the prior build; Google: halt the staged rollout and roll back to the previous release in the track). | Kody (store accounts) | HOLD: no store account exists yet; the exact console steps are named in `signing-and-submission.md` |

The database is never rolled back by running an old migration: HIVE
migrations are forward-only, and a fix ships as a new migration. A
restore from backup is the last resort and is drilled below.

## Pause and resume, exactly

Local stack:

```bash
node scripts/local-supabase.mjs pause-service incident
```

```bash
node scripts/local-supabase.mjs service-status
```

```bash
node scripts/local-supabase.mjs resume-service
```

The switch is `public.set_service_state(state, reason, min_app_version,
idempotency_key)`, executable by the server role alone; every change is
appended to `service_status_changes`; the same key never writes twice.
The app reads `public.service_status_read()` at boot and on every return
to the foreground, with the public key and nothing identifying anyone.

On a hosted project the same calls run through the hosted operator mode
(WO-011), from the operator's machine, never from the app:

```bash
node scripts/hosted-supabase.mjs production pause-service incident --confirm nceencyvxfhkffbjqlea
```

```bash
node scripts/hosted-supabase.mjs production service-status
```

```bash
node scripts/hosted-supabase.mjs production resume-service --confirm nceencyvxfhkffbjqlea
```

Staging takes the same commands without `--confirm`. A pause or a resume
keeps the minimum app version the service already holds; to raise it
(lever 2), set `HIVE_SERVICE_MIN_VERSION` for that one command. Who may
run them, provisionally (2026-09-30, Kody's to ratify): Kody, or a
session he has instructed, from his desktop under his Supabase CLI login;
the project's secret key is read for one command and kept nowhere.
Drilled on staging on 2026-09-30
(`security/evidence/2026-09-30-hosted-operator/operator-kill-switch.log`).

## Backup and restore, drilled

```bash
node scripts/local-supabase.mjs drill-backup
```

The drill dumps the running database with the platform's own tool inside
its container, restores the dump into a scratch database there, compares
the row count of all twenty-one counted tables (the seventeen protected
tables, memberships, the append-only audit receipts, and the three
release-control tables) between the source and the restore, prints the
counts, and drops the scratch database. Its record for this candidate is
in `security/evidence/2026-09-28-desktop-m6/backup-drill.log`.

What the drill does not cover: a hosted project's managed backups and
point-in-time recovery, which do not exist until a hosted project does
(HOLD), and the storage bucket (quarantine holds nothing it has judged;
a checked document's bytes are the client's original, and the record of
them is the digest in `document_uploads`).

## Incident stop rules, restated for a release

1. **Suspected data exposure across a boundary:** pause the service first,
   then investigate. Pausing costs nothing and loses nothing.
2. **A broken client build in the field:** raise the minimum app version
   to the first good build; resubmit; the stuck build shows the update
   screen and nothing else.
3. **A broken server migration:** pause, ship the forward fix as a new
   migration, verify on the local stack against the drill's restore,
   resume. Restore from backup only if data is wrong, and only after
   Kody names the point to restore to.
4. **Every pause and resume is written to the history table and, with a
   hosted project, to the incident log with the reason code.** The app's
   wording for each reason code is in `labels.ts`; Stacie's to replace.

## What is HOLD in this runbook

- The store consoles (Apple App Store Connect, Google Play Console) and
  the accounts that act in them.
- Who may pause a hosted project: recorded provisionally on 2026-09-30
  (above), and Kody's to ratify. A pause of production itself stays his
  call each time.
- Managed backups and point-in-time recovery on a hosted project.
- Any OTA lane: none exists and none is planned before signing, rollout,
  rollback, and approval are tested (the brief).
