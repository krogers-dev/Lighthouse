# ADR 0002 — Picking a document: `expo-document-picker`

**Status:** Accepted (Work Order 003, 2026-09-28). **Owner:** Kody
(capability decisions), under the standing instruction of 2026-09-18.

## Decision

Add `expo-document-picker` 57.0.2, exact pin, as the one way a document
enters HIVE. The picker is the platform's own document UI
(`UIDocumentPickerViewController` on iOS, the Storage Access Framework on
Android), opened for a single file of the four approved types with the
file copied into the app's cache so it can be read at once. Reading the
bytes and discarding the copy use `expo-file-system` (already a
dependency, for the install marker), and the on-phone SHA-256 uses
`expo-crypto` (already a dependency, for the install marker's random
source). Nothing else was added.

## The dependency rule, applied

| Question                                 | Answer                                                                                                                                                                                                                                                                                                                         |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Required user outcome                    | A client user chooses a document from their own phone to answer a request (WO-003 R5)                                                                                                                                                                                                                                          |
| Why nothing installed suffices           | React Native core has no file picker; `expo-file-system` reads files it is handed a uri for but cannot present the system chooser; `expo-image-picker` (not installed) is photos and camera only, and PDFs and CSVs are the common case                                                                                        |
| Exact version and source                 | `expo-document-picker@57.0.2` from the npm registry, integrity in `package-lock.json` (`sha512-vVBbBNg0…`), the SDK 57 line (`bundledNativeModules.json`: `~57.0.1`); the latest 57.x on 2026-09-28                                                                                                                            |
| Native permissions and store disclosures | None. Neither platform requires a permission for its document picker; the iCloud container entitlement is NOT enabled (the config plugin is not added to `app.json`), so no iCloud capability appears. The privacy answer stays "user-selected files, for app functionality"; a HOLD item for the release-candidate checkpoint |
| Maintenance and security posture         | Expo-maintained, released with every SDK; the API used is the one documented surface (`getDocumentAsync`)                                                                                                                                                                                                                      |
| Bundle impact                            | One small native module; no JavaScript of note                                                                                                                                                                                                                                                                                 |
| Removal and rollback                     | Remove the package and `src/features/documents/expo-adapters.ts`; the flow depends only on the `DocumentSource` port, so the screens and tests stand without it                                                                                                                                                                |

## Rejected alternatives

- **A custom file browser** over `expo-file-system` directories: would
  need broad storage permissions on Android and a store disclosure for
  them, and would show the person a worse chooser than the one they
  already know. Rejected.
- **`expo-image-picker`:** photos and camera only; a bank statement is a
  PDF. Rejected for this milestone; a camera capture path can be its own
  decision later.
- **Uploading through `Blob`/`FormData`:** the pinned `storage-js`
  documents that these "do not work as intended" in React Native and
  recommends an `ArrayBuffer` body; the repository sends exactly the
  bytes it digested, as an `ArrayBuffer`.
- **Digesting in JavaScript on the phone:** the reviewed pure SHA-256
  (`src/core/sha256.ts`) exists and is what the tests and the live bridge
  use, but 20 MB through it on Hermes is seconds of blocked UI;
  `expo-crypto`'s `digest` is the platform's own and returns in
  milliseconds. Both produce the same digest, and the lanes prove it.

## What this does not decide

Whether a document may also be captured by camera, whether more than one
document may be picked at once, and any change to the four types or the
20 MB limit. Those are product decisions for Kody; the code holds the
limits in one place (`src/features/documents/document-rules.ts`) and the
server holds them again.
