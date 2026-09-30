# The Cloud doors for the live adapters — 2026-09-30

From Kody's own signed-in Chrome (`info@myhbcfo.com`, project `hive`,
ID `hive-510122`), at his request of 2026-09-30 ("can you do #4 for
me?"). One change, the rest read-only. No key was created, no role was
granted, no policy was changed, and nothing in Honeybee's Drive was
opened.

| Step | Action | Result |
| ---- | ------ | ------ |
| 1 | the duplicate `hive-drive-reader-636` (unique ID `109905053133701888530`, no key, no role) opened by its own detail page, disabled, then deleted | ✅ "Account hive-drive-reader has been deleted"; the list shows the one account, enabled, no keys — `service-accounts-after-delete.jpg` |
| 2 | read: the organization policy "Disable service account key creation" (managed) as it applies to project `hive` | enforced, inherited — `org-policy-key-creation-enforced.jpg` |
| 3 | read: "Disable Service Account Key Upload" (legacy) | enforced, inherited — `org-policy-key-upload-enforced.jpg` |
| 4 | read: the legacy creation constraint and the managed upload constraint | not enforced; Google evaluates both generations together, so creation and upload are both refused |
| 5 | read: Google's references for the Drive interface (the file resource, reading one file, restricting service accounts) | a stored file's metadata carries a SHA-256 checksum; reading one file's metadata accepts the metadata-only permission; the constraints are not retroactive |

## One slip, without effect

The first attempt was made from the list page. The page's layout shifted
as a help panel opened, the click landed on the row of the account that
is kept, and the delete dialog opened for that account. It was cancelled
and nothing was deleted. The deletion was then done from the duplicate's
own detail page, addressed by its unique ID, where no other account can
be the one selected.

## What this proves

- Exactly one service account exists in the project, the one the plan
  names, and it holds no key and no role.
- A key for it cannot be created or uploaded while the organization's
  defaults apply to the project: the step the plan left to Kody would be
  refused as written. Section 6 of the work order
  (`docs/plans/2026-09-29-wo-010-live-source-adapters.md`) now carries
  the choices and a recommendation.

## What this does not prove

- That Honeybee's Workspace allows a folder to be shared with an address
  outside the organization; the test-folder share is that test, and it is
  Kody's.
- That the checksum is present for every file type Honeybee files; the
  adapter's contract tests against the test folder settle it.
