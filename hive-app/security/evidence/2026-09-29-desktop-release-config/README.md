# The release configuration under the general grant — 2026-09-29

Executed on Kody's Windows desktop from a local Claude session, at the
tree committed with this record, after Kody's written general grant of
2026-09-29. Nothing here creates an account, spends, accepts a term,
submits, or releases: those are Kody's own actions, listed in
`docs/release/signing-and-submission.md`.

| Step | Command                                                              | Result                                                                                                                                    |
| ---- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `APP_VARIANT=production npx expo config --type public`              | ✅ `com.myhbcfo.hive` on both platforms, "HIVE", scheme `hive`, version 1.0.0, build 1 — `config-check-and-variant.log`                    |
| 2    | `npm run config:check` (development)                                 | ✅ OK: app.json is still the development configuration every device flow carries                                                          |
| 3    | `npm run config:check -- --profile release`                          | ✅ FAILS by design with exactly five findings, each a value only Kody supplies: the hosted origin (three findings), the support address, the public deletion page |
| 4    | `node --test` on the variant and the config check                    | ✅ see the work order's gate table                                                                                                        |
| 5    | the reviewer demo video (runner `--then case-sources.yaml`, recorded from the login on) | ✅ kept outside the repository in Kody's approvals folder (`HIVE-approvals\review-demo\`); the enrollment screen is never in it |

## What this proves

- The release is one environment variable away from its identifiers,
  and nothing about them is guessed at build time: the variant is code,
  pinned by a test, and the development configuration is untouched.
- The remaining release findings are exactly the things that need
  Kody's own accounts, domain, and pages, and nothing else.
