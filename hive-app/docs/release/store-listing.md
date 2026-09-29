# Store listing and assets (WO-007, prepared 2026-09-28)

**Status: draft copy for Stacie's approval; every field that names a real
address, page, or account is HOLD and marked.** Nothing here is published
anywhere.

## Listing copy (draft, Stacie's to approve)

| Field                           | Draft                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Name                            | HIVE by Honeybee Accounting                                                                                                                                                                                                                                                                                                                                                                                                   |
| Subtitle (iOS, 30)              | Your books, one calm view                                                                                                                                                                                                                                                                                                                                                                                                     |
| Short description (Android, 80) | See where your books stand, what Honeybee needs from you, and what happens next.                                                                                                                                                                                                                                                                                                                                              |
| Description                     | HIVE is where Honeybee Accounting clients see the status of their books, the questions and document requests that need them, and what happens next. Answer a question, add a document from your phone, and watch the case move. HIVE is by invitation: your Honeybee team sets up your access. It is not a ledger and holds no balances or account numbers; QuickBooks Online and your permanent records stay where they are. |
| Keywords (iOS, 100)             | honeybee,accounting,bookkeeping,books,requests,documents,status                                                                                                                                                                                                                                                                                                                                                               |
| Category                        | Business (primary); Finance (secondary) is Kody's call, given no financial values are shown                                                                                                                                                                                                                                                                                                                                   |
| Age rating                      | 4+ / Everyone (no objectionable content, no user-to-user interaction, no purchases)                                                                                                                                                                                                                                                                                                                                           |
| Support URL                     | the support address is `info@myhbcfo.com` (decided 2026-09-29); the URL is a page on Honeybee's site that shows it, HOLD until Kody publishes one (the deletion page can carry it)                                                                                                                                                                                                                                            |
| Privacy policy URL              | the policy is `privacy-policy.md` (Kody's entity, address, and retention wording; standard paragraphs pending his counsel); HOLD until the page is live at the address ChatGPT gives (`site-pages-to-publish.md`)                                                                                                                                                                                                             |
| Account deletion page           | content in `deletion-page.md` and `site-pages-to-publish.md`; HOLD until Kody publishes it (suggested `hive.myhbcfo.com/delete-account`) and names the URL for `EXPO_PUBLIC_DELETION_INFO_URL`                                                                                                                                                                                                                                |
| Marketing URL                   | optional; HOLD if used                                                                                                                                                                                                                                                                                                                                                                                                        |

## Screenshots, sizes, and the rule

Synthetic data only, "(Synthetic)" labels visible, never a real name,
entity, filename, or amount. Captured from the QA build with the seeded
stack, with the device's clock and status bar as they are.

| Store       | Required                                                                                                  | Source                                                                    |
| ----------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Apple       | 6.9" (1320x2868) and 6.5" (1284x2778 or 1242x2688); iPad 13" (2064x2752) because `supportsTablet` is true | iOS simulator on a Mac (HOLD: no Mac lane on this desktop)                |
| Google Play | Phone (1080x2400 works), 7" and 10" tablet, feature graphic 1024x500                                      | `Pixel_8` emulator; the feature graphic from the brand mark on Deep Black |

Candidate phone frames from this milestone's device lane are in
`security/evidence/2026-09-28-desktop-m6/` (the paused screen and the
account screen) and the earlier milestones' folders (Home, Requests, a
request with its document, the case review). The set to submit is
Stacie's choice; the assets are exported from the approved brand kit
(`assets/brand`, `assets/images`) and never redrawn.

## Reviewer notes (draft)

"HIVE is an invitation-only app for Honeybee Accounting's clients and
staff. Accounts cannot be created in the app. Sign-in uses a one-time
code sent by email, and staff accounts also use an authenticator. For
review, use the review account: the review email and the review code
in these notes work for this review window only. A short video of the
staff surface is attached." The mechanism is built (option A,
`review-tenant.md`); the hosted hook, the mailbox, and each window's
notes are Kody's steps in the checklist.
