# Getting the two store accounts started (prepared 2026-09-29 at Kody's request)

**Status: a walk-through for Kody. Both accounts are Honeybee's, held in
Honeybee's name, created by Kody: each needs an account of his, a fee, and
accepted terms, none of which this session does. What is written here is
what to have ready and what happens at each door.**

## 0. One number both stores ask for

Apple and Google both verify an organization by its **D-U-N-S number**, a
free identifier Dun & Bradstreet assigns to a legal entity. Check whether
Honeybee Accounting already has one at
<https://developer.apple.com/enroll/duns-lookup/> (any Apple Account can
use the lookup) or <https://www.dnb.com/duns-number/lookup.html>. If it does
not, request one there, free; a new number takes days to a few weeks, so
this comes first. Have ready: the exact legal entity name, its registered
address, and a phone number.

**Status 2026-09-29:** no existing number was found; Kody submitted the
free D-U-N-S application himself the same day (Dun & Bradstreet case
DFC-692444), and the number arrived by email at 3:09 PM: **D-U-N-S
149968881** for Myhbcfo, LLC. It is a public business identifier, not a
secret, and both store forms take it. Both store sign-ups wait for it,
and each must be started signed in as `info@myhbcfo.com`, because the
creating account owns the developer account permanently.

## 1. Apple Developer Program (the iPhone side)

- Where: <https://developer.apple.com/programs/enroll/>.
- With: an Apple Account on a Honeybee address (info@myhbcfo.com works)
  with two-factor authentication turned on; sign in there first.
- Enroll as an **Organization**, not an individual, so the app is
  published under Honeybee's name. Apple asks for the legal entity name,
  the D-U-N-S number, the website (`myhbcfo.com`), and that the person
  enrolling has the authority to bind the organization; Apple may call or
  email to verify, which takes from a day to a couple of weeks.
- Fee: 99 US dollars a year. Terms: the Apple Developer Program License
  Agreement, accepted by Kody.
- After: App Store Connect exists for Honeybee. The app record, its
  identifiers (`com.myhbcfo.hive`), certificates, and profiles come next,
  and those steps are written in `signing-and-submission.md`.

## 2. Google Play Console (the Android side)

- Where: <https://play.google.com/console/signup>.
- With: a Google account. A Google Workspace account on the domain is
  right (info@myhbcfo.com, or a dedicated address such as
  developer@myhbcfo.com if Kody prefers to keep the console separate).
- Choose an **Organization** account. Google asks for the legal name and
  address, the D-U-N-S number, the website, a contact email and phone that
  will be verified, and an identity check of the person enrolling.
  Organization accounts skip the testing requirement Google places on
  personal accounts.
- Fee: 25 US dollars, once. Terms: the Google Play Developer Distribution
  Agreement, accepted by Kody.
- After: the console exists; the app record and the upload key follow, as
  written in `signing-and-submission.md`.

## 3. What this session does once the accounts exist

- Writes the production build profile and widens `eas:guard` for it, as
  the checklist records.
- Prepares every store form answer from `store-listing.md` and
  `privacy-disclosures.md`, so Kody fills each screen from a list.
- Builds the release candidates and hands them to TestFlight and the
  internal track once Kody's Expo account is signed in, another door.

Nothing about the accounts themselves, the fees, or the terms is done
here.
