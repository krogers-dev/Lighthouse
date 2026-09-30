# Claude: implement the HIVE 2026 design

Use this attached design package to refresh HIVE’s native iOS and Android appearance. The package is a **design draft for implementation and review**, not approval to publish.

Read `README.md`, `HIVE-2026-Design-Direction.pdf`, `tokens.reference.ts`, `Implementation-Map.md`, and `asset-manifest.json` before editing. The supplied current Honeybee Brand Kit v3 references supersede the repository’s v2 palette and typography instructions. Use the exact approved HIVE honeycomb mark supplied in `assets/`; Honeybee’s bee logo is a separate brand asset.

Start from the latest state of `krogers-dev/Lighthouse`, branch `claude/hive-fable-5-greenfield-p0cwkq`. The source reviewed for this package was commit `ca961818b68321791ab8b8de4b0bd345bb428999`. The app is in `hive-app/`. Inspect changes since that checkpoint and preserve them.

## Visual direction

Match the supplied PDF and token reference: dark header chrome and bottom navigation in both themes; warm paper content in light mode; dark ink content at night; restrained honey accents, sage status treatments, thin rules, clear spacing and strong hierarchy.

Use the supplied real Manrope static weights 400, 500, 600, 700 and 800. Map each role to its actual font file rather than relying on synthetic weights. Use `assets/hive-mark-primary-512.png` with its existing transparent background and 512:460 aspect ratio. Load it locally, preserve clear space, and verify its fallback. Do not add a backing rectangle, tile, border, or shadow. The former opaque bitmap is historical reference only. Do not redraw the mark.

## Implementation scope

Keep the existing five destinations: Home, Requests, Activity, Help and Account. This milestone remains read-only. Preserve current props, handlers, route behavior, testIDs, source-backed status and date wording, and conditional controls.

Begin with one reviewable slice:

1. Update shared semantic tokens, approved font loading, the logo and navigation.
2. Apply the supplied Home and Requests layouts using the existing data contracts.
3. Verify that slice, then carry the same system through request detail, Activity, Help, Account, sign-in, workspace selection and every existing state.

Retain the current stack and dependencies wherever possible. Use the package’s reference tokens as guidance for the existing semantic interface, checking actual rendered color combinations rather than copying values without review.

Update the native `app.json` splash, background and adaptive-icon configuration where needed; colors also exist there. Update `AppText` and native `TextInput` typography explicitly. Adding `fontFamily` to tokens alone is insufficient. Replace the obsolete test that prohibits font families with meaningful checks for the approved bundled fonts. Record the new design authority in the relevant project documentation while preserving historical decisions.

Do not introduce unsupported upload, response, edit, financial dashboard, payment, approval, account-deletion, chat or notification features. Keep support links and workspace switching conditional on the existing configuration and permissions.

## Controls and verification

Preserve authentication, client/entity isolation, scope invalidation, source-record boundaries and safe retries. Preserve the session-storage quarantine state and verified reset sequence. Keep navigation hidden during sign-out and prevent protected content from returning after scope or access changes.

Use synthetic fixtures only. Preserve persistent labels, semantic accessibility states, visible focus, 48-unit minimum touch targets (meeting the 44pt iOS / 48dp Android floors), 200% text, reduced motion, safe areas, portrait/landscape and phone/tablet behavior. Keep loading, empty, offline, denied, expired, stale-scope, error and quarantine states explicit. Do not show stale protected content behind an offline or denied state.

Run the relevant type, lint, contrast, primitive, feature, navigation and isolation checks. Capture reviewed screenshots in both themes and at large text sizes, including representative error and offline states. Run native/device checks available in the environment and identify any unavailable device lane precisely. Existing website test counts are not evidence for this native branch.

Proceed with safe local implementation without another confirmation. Return the changed files, screenshots, fresh commands and results, remaining issues, and the next implementation task. Distinguish the design checkpoint from native release readiness. Do not publish, deploy, submit to stores, alter signing or use production data.

