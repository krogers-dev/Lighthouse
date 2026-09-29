# Work Order 010 — Live source adapters (QuickBooks Online and Google Drive)

**Status: planned 2026-09-29 at Kody's instruction ("Work through this to
give the best client experience possible"), under the direction he
supported the same day (live status first, then instant updates). Not
started: the two live connections need accounts and reviews that are his,
listed in section 6. Everything on the HIVE side that the live halves
plug into exists from Milestone 5 and is proven synthetic.**

**Owner:** Kody (the accounts, the security review, the adapter PASS).
**Wording:** Stacie.

## 1. What the client should feel

A client opens HIVE and what they see is true as of minutes ago, not as
of the last time a person typed. When they add the statement Honeybee
asked for, the request shows it was received and checked without anyone
at Honeybee touching a keyboard; when Honeybee files it to the permanent
record, the client sees "filed" with the time; when the books for the
month are reconciled in QuickBooks, the case says so the next time the
job runs. Nothing they see is a number from the ledger, and nothing
Honeybee does in QuickBooks or Drive is done by HIVE.

## 2. What exists (Milestone 5) and what is added

| Exists                                                                                                                                              | Added by this work order                                                                                            |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `ledger_references`: what a read-only look at the ledger saw (type, id, version, label, as-of, digest), immutable, recorded by the server role only | the live QuickBooks Online adapter that produces them for the objects a case refers to, on a schedule and on demand |
| `filing_receipts`: a person filed a checked document to Drive by hand; the adapter verifies the bytes                                               | the live Google Drive adapter that performs that verification against the real folder                               |
| The named synthetic adapters, production-inert                                                                                                      | the named live adapters, selected by configuration on the server only, never in the app                             |
| The trail (`source.*`, `record.*`) and the case review's sources view                                                                               | a freshness line per source ("checked with QuickBooks at …") and evidence-driven prompts for staff (section 4)      |

## 3. Where the live halves run

On the server, never in the app. The recommended home is a scheduled
job inside the hosted project: pg_cron (already in use for the review
sweep) calls an Edge Function through pg_net on a schedule; the Edge
Function holds the vendor credentials as function secrets, reads from
the vendor, and calls the server-role functions that record references
and verify receipts. Nothing new reaches the phone: the app keeps
reading the same tables through the same row-level security.

- **QuickBooks Online.** Intuit's sign-in library and its accounting
  interface; a sandbox company for development. There is no read-only
  permission for accounting data in QuickBooks, so read-only is a rule
  of our code, reviewed: the adapter issues queries and reports only,
  never a create, update, or delete call, and a test asserts the client
  it builds has no write method reachable. What leaves QuickBooks: an
  object's type, identifier, version, own label, and time, plus a digest
  computed in memory over what was read; the values themselves are
  never written anywhere.
- **Google Drive.** The Drive interface with its read-only permission,
  through a service account that Honeybee's Workspace admin grants read
  access to the permanent-record folder alone. What leaves Drive: the
  file's identifier, size, modification time, and a digest of its bytes,
  compared with the receipt's claimed digest; the bytes are streamed and
  discarded.
- **Schedule.** Every fifteen minutes for cases in an active status; a
  staff member may ask for a refresh of one case from the case review,
  which runs the same job for that case at once. Vendor rate limits are
  far above this.

## 4. The client experience, concretely

1. **Freshness, always visible.** The dashboard's "Recorded through"
   line becomes the true time of the last successful check for that
   scope; a source that could not be reached shows the time it was last
   reached, never a guess.
2. **Received and checked without a hand.** The upload flow already
   checks and digests a document; the receipt and verification make
   "filed" and "verified" appear on the request as soon as Honeybee
   files it.
3. **Evidence-driven prompts for staff, not automatic workflow.** When
   a reference shows the ledger object a case is waiting on has a new
   version, the case review shows "changed in QuickBooks since the last
   review" and offers the staff member the transition; HIVE never moves
   a case on its own, as the product rule says.
4. **Nothing to learn.** No new screen for clients; the same calm view,
   truer.

## 5. Security and privacy

- The app is unchanged: no new permission, no new data on the device,
  no vendor library in the bundle; `privacy:reconcile` stays green
  without a change to the disclosures beyond naming the two providers
  as sources read on the server (the policy already names Supabase and
  Resend; Intuit and Google are added as systems HIVE reads, not as
  recipients of client data).
- Credentials live only in the hosted project's function secrets and
  Vault; rotation is a documented operator step; the app never sees a
  token.
- The adapters record identifiers and digests, never a value; the data
  classification does not change. A test proves the recorded row
  contains nothing but the allowed columns, and a review of the adapter
  code by Kody is the adapter PASS the product page requires.
- Every recorded reference and verification writes the same audit
  receipt as today; a failed vendor call writes a receipt with the
  failure class and no payload.

## 6. Doors (Kody's), in order

1. **Intuit developer account** at developer.intuit.com, an app for HIVE
   with the accounting permission, and its sandbox company: the
   development target. Later, Honeybee's live QuickBooks company is
   connected by Kody's own sign-in to Intuit, once, and the refresh
   token goes into the function secrets.
2. **Google Cloud project** for Honeybee, the Drive interface enabled, a
   service account with a key placed in the function secrets, and read
   access to the permanent-record folder granted to that service
   account by the Workspace admin.
3. **The security review** of the two adapters, by Kody, against
   section 5, before either touches a live company.
4. **The adapter PASS**, per PRODUCT.md, recorded in the register.

## 7. Proof

- Contract tests for each adapter against the sandbox company and a
  test Drive folder with synthetic documents, asserting the recorded
  shape and the read-only rule.
- pgTAP for the new refresh functions (freshness, staff prompt,
  on-demand refresh authority at AAL2).
- The harness step that runs one scheduled pass against the synthetic
  adapters and one against the sandbox adapters, comparing the trail.
- The device flow: a request going from "added" to "filed" and
  "verified" with no staff action in the app.

## 8. Sequence and size

After WO-009 (done) and before the store release candidate's exact-build
approval only if the doors open in time; otherwise right after launch as
an app-side no-op (everything is server-side) and a server-side release.
About two weeks of work once door 1 is open, one more for door 2, plus
Kody's review.
