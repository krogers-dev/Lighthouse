# Privacy disclosures (WO-007, prepared 2026-09-28)

**Status: prepared and reconciled against the code and the configuration
by `npm run privacy:reconcile`; the store forms themselves (Apple's
privacy nutrition labels, Google's Data safety form) are HOLD until Kody
submits them. The machine-readable source of these answers is
`privacy-disclosures.json`; the gate fails if the code or app.json drift
from it.**

## The answers

| Question                                  | Answer                                                                                                                                                                                                                                                 |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Does the app track users?                 | No. No tracking, no tracking domains, no advertising identifier.                                                                                                                                                                                       |
| Third-party analytics, crash, or ads SDKs | None. `privacy:reconcile` refuses any dependency that looks like one.                                                                                                                                                                                  |
| Data collected, linked to the person      | Email address (sign-in identity); user id (the account id memberships and records name); other user content (documents a client adds and answers a client gives). Purpose: app functionality only. None used for tracking.                             |
| Data not collected                        | Location, contacts, photos beyond the one file the person picks, health, financial information (no amount, balance, or account number exists in any shape), browsing or search history, device id, advertising data, crash or performance diagnostics. |
| Permissions                               | Android: INTERNET only (implicit). iOS: no usage descriptions; the file picker needs none.                                                                                                                                                             |
| Where data goes                           | The configured Supabase origin only; no host is written into the code.                                                                                                                                                                                 |
| Encryption (export compliance)            | Standard TLS through the platform only; `ITSAppUsesNonExemptEncryption` is false.                                                                                                                                                                      |
| iOS privacy manifest                      | Declared in app.json: no tracking; the three collected data types above; no accessed API categories (the app's own code reads a picked file's bytes and size, never file timestamps, user defaults, or disk space).                                    |
| Account deletion                          | In the app: Account > Delete your account (renders only with the public deletion page configured). The public page is HOLD (Kody supplies it).                                                                                                         |
| Financial features declaration            | HIVE holds no financial values and moves no money. The store's own declaration is Kody's to answer (HOLD).                                                                                                                                             |

## How the gate keeps this true

`scripts/privacy-reconcile.mjs` checks, on every run:

1. no dependency matches the analytics, crash, advertising, or tracking
   SDK denylist, and the disclosure names none;
2. app.json declares no Android permission and no iOS usage description
   the disclosure does not name;
3. the iOS privacy manifest in app.json says exactly what the disclosure
   says (tracking, collected types and their linkage, accessed APIs);
4. the export-compliance answer matches app.json;
5. no host is written into the app's source (comments excluded);
6. `docs/data-classification.md` still excludes financial values.
