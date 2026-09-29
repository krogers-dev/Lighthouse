# Signing and submission checklist (WO-007, prepared 2026-09-28)

**Status: prepared. Every item below is HOLD until Kody grants the exact
authority it names; nothing in the repository is configured for a signed
or submitted lane, and `eas:guard` refuses any such configuration on
purpose.** This page exists so that when authority arrives, the work is
a sequence of known steps with known evidence, not a discovery.

## What exists today

- The Milestone 2 QA development build (`com.myhbcfo.hive.development`,
  "HIVE Dev") on the desktop emulator, and the `ios-simulator` EAS profile
  that answers one question: does the app compile for iOS.
- `config:check --profile release` fails today by design: no production
  identifiers, no approved origin, no support address, no deletion page.
  Each failure names its HOLD.
- `export:candidate` proves a release-shaped bundle carries no QA hook and
  no secret.

## The authority each step needs

| Step | Action                                                                                                                                                                                                                                                                                                                                | Authority needed from Kody                                                                                               | Evidence when done                                                                                       |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| 1    | Choose the production identifiers (iOS bundle id, Android application id, display name "HIVE")                                                                                                                                                                                                                                        | The identifiers themselves (a HOLD decision recorded in `config:check`)                                                  | `config:check --profile release` no longer names them                                                    |
| 2    | Create the hosted Supabase project for staging; record its origin in the approved-origins manifest                                                                                                                                                                                                                                    | The project, its plan, its region, its custodians; the SMTP or Send Email Hook decision (PRODUCT.md)                     | the hosted OTP acceptance (PRODUCT.md, four steps)                                                       |
| 3    | Supply the two public contacts: the support address and the public deletion page                                                                                                                                                                                                                                                      | The address and the page (real, not reserved)                                                                            | `config:check --profile release` passes the contacts                                                     |
| 4    | Apple Developer Program membership, App Store Connect app record, certificates and profiles                                                                                                                                                                                                                                           | The account, who holds it, and whether EAS manages credentials                                                           | a signed build on TestFlight                                                                             |
| 5    | Google Play Console developer account, app record, upload key                                                                                                                                                                                                                                                                         | The account and who holds the key                                                                                        | a signed build on the internal testing track                                                             |
| 6    | Add the `production` build profile to `eas.json` and widen `eas:guard` to admit exactly it                                                                                                                                                                                                                                            | Kody's written word for that exact change                                                                                | the guard's test names the new authorized profile                                                        |
| 7    | Build: `eas build --profile production --platform ios` and `--platform android`                                                                                                                                                                                                                                                       | Step 4 and 5 accounts                                                                                                    | build ids, artifact digests, the bundle inspection                                                       |
| 8    | Submit to TestFlight and the internal track only (`eas submit` never lives in the repository config)                                                                                                                                                                                                                                  | Per-submission word naming the build id and the destination                                                              | the store's build page                                                                                   |
| 9    | Internal testing: the Maestro flows on real devices, the accessibility smoke with a screen reader                                                                                                                                                                                                                                     | None beyond the testers' devices                                                                                         | `security/evidence/<date>-release-candidate/`                                                            |
| 10   | Store listings, disclosures, age rating, financial-features declaration, export compliance; the review account (option A: enable the password-verification hook on the hosted project, give the review identity a controlled mailbox, `seed-review`, `open-review-window` for the submission, the email and code in the review notes) | Kody answers the forms from `privacy-disclosures.md`; Stacie approves the copy; Kody enables the hook and holds the code | the console's saved answers, screenshotted into evidence; `review-window-status` open for the submission |
| 11   | Production release (store binaries only; no OTA lane)                                                                                                                                                                                                                                                                                 | Joint exact-build approval: build id, digest, destination, date                                                          | the release record in `security/APPROVALS.md`                                                            |

## Exact commands, prepared and not run

```bash
npm run config:check -- --profile release
```

```bash
npm run export:candidate
```

```bash
npx eas build --profile production --platform ios
```

```bash
npx eas build --profile production --platform android
```

Submission is never automated from the repository. When authority
arrives, the submit step is run by Kody from the console or by an
explicitly authorized `eas submit` invocation recorded in the approvals
file with the build id it submitted.

## Versioning, decided provisionally

- `app.json` `version` stays `0.1.0` until Kody names the first release
  version; the release candidate becomes `1.0.0`.
- `ios.buildNumber` and `android.versionCode` are set per build by the
  release coordinator and recorded with the build id; they never
  auto-increment from a local machine.
- The minimum app version the service enforces starts at `0.0.0` and is
  raised only by the runbook's incident rule 2.
