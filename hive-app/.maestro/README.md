# Maestro flows — HIVE Milestone 0

Critical-path flows for iOS and Android development builds. This
environment has no device or simulator lane, so these are authored and
reviewed but not yet executed (device lane HOLD).

Prerequisites on a machine with a device lane:

1. `node scripts/local-supabase.mjs up` (Docker) — or the db-local fallback
   plus a reachable Auth stack.
2. `node scripts/local-supabase.mjs seed` for the synthetic users.
3. A development build installed (`npx --no-install expo run:ios` /
   `run:android`).
4. The one-time code arrives in the local Mailpit (http://127.0.0.1:54324);
   pass it to the flow: `maestro test -e OTP_CODE=123456 .maestro/sign-in.yaml`.

All identities are synthetic (`example.invalid`).
