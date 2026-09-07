# HIVE 2026 app design handoff

Design proposal prepared September 7, 2026. This is a reviewed visual reference and implementation brief. The native app has not been changed by this task. Updated at the user’s request to use a transparent HIVE mark throughout the design.

## Start here

1. Review `HIVE-2026-Design-Direction.pdf` for the proposed look.
2. Give Claude the package, then paste `Claude-Start-Here.md`.
3. Claude should implement in the existing native app and return working screenshots and test evidence. Do not transfer prior website test counts or release status to this branch.

The PDF contains seven pages: an overview, Home/Requests, detail/Activity, sign-in/Help/Account, dark mode, the design system, and the implementation path. It contains seven distinct screen compositions and two dark-mode examples. All examples use synthetic data. The PDF is a static reference, not a tappable prototype or running application.

## Current authority

- Published Honeybee visual source: https://myhbcfo.com/.
- Honeybee Brand Kit v3.0, effective August 21, 2026, approved by Kody Rogers. The original PDF is included in `source/`. It supersedes v2.0 and Rose + Slate.
- HIVE identity: the separate honeycomb mark supplied and approved August 25, 2026. It replaces the company bee on HIVE product surfaces. The application lockup is HIVE with “by Honeybee Accounting.”
- Current HIVE reference: https://hive.myhbcfo.com/. The provided conversation reports v21 fixed the header mark. Current local source corroborates the exact fixed static mark and Manrope. No claim is made here that we reran live deployment verification.
- Native source reviewed: https://github.com/krogers-dev/Lighthouse/tree/claude/hive-fable-5-greenfield-p0cwkq/hive-app at `ca961818b68321791ab8b8de4b0bd345bb428999`.
- Local published-app source used for assets: commit `4ab5be3291b7fec7d294051883dd229893913eef`. Asset hashes and identities are in `asset-manifest.json`.

The native branch still cites v2.0 and system fonts. Its actual token path is `hive-app/src/ui/tokens.ts`. Seven shared primitives and 24 semantic color roles were verified. `PrimaryNav.tsx` and native `app.json` also need a visual update. We did not verify the quoted count of 27 screens; the tree has 13 route modules plus the root layout, with overlapping screen, view, and state components.

## Proposed visual direction

Use a dark HIVE header and pinned bottom navigation in both themes. Light-mode content uses Warm Paper. Dark-mode content uses Soft Black. Warm Canvas surrounds larger layouts. Honey Gold identifies the selected destination and primary action on dark. Soft Black actions with Warm Paper text belong on light content.

Use Manrope for every text surface. Case/request titles lead, followed by exact status, attention, next action, owner and dates. Lists use thin rules. Avoid decorative dashboards, honeycomb wallpaper, gradients outside approved artwork, exaggerated shadows, glass panels, and generic metric cards.

`tokens.reference.ts` is the controlling proposed code mapping in this package. It retains the current 24 semantic names and adds a separate dark-chrome presentation object. It is not a drop-in replacement for the complete existing token module. Preserve its other helpers and exports.

## Assets and fonts

- `assets/hive-mark-primary-512.png`: the active transparent HIVE mark for this design. Existing approved 512 × 460 artwork, unchanged. Use the full canvas at its natural aspect ratio. Render directly on the app surface without a backing rectangle, tile, border, or shadow.
- `assets/hive-mark-soft-black.svg`: existing approved transparent one-color variant, used on light document backgrounds for visibility. App chrome remains gold on dark. No recoloring or geometry changes were made.
- `assets/hive-mark-primary.svg`: existing supplied scalable transparent derivative. The PNG derivative was visually compared with the supplied mark and retains its geometry and gold finish. Do not redraw or recolor.
- `assets/HIVE-Mark-Transparent-2048.png`: existing August 25 retained transparent derivative, unchanged. Its provenance is in the manifest.
- `assets/manrope-latin-variable.woff2`: exact current self-hosted font. Web reference only; do not assume a web font is a native font asset.
- `assets/Manrope-400.ttf` through `Manrope-800.ttf`: five static instances generated from that variable source. Unique internal family/PostScript names prevent weight aliasing. PDF embeds all five. Native platform loading, glyph coverage, font metrics, and fallback require implementation QA.
- `assets/OFL.txt`: Manrope license from the Google Fonts source repository. Font copyright notices from the supplied font are retained in `assets/Font-Source-Notice.txt`.

The former opaque 138 × 124 bitmap is retained only as `source/hive-product-mark-opaque-reference.png` for provenance. It is superseded for in-app placement by this transparent-mark direction. Native store-icon background rules remain a separate packaging concern.

Bundle assets locally. Do not introduce runtime font/CDN requests or logo hotlinks. Use a bounded HIVE text fallback if image loading fails without affecting auth or data handling. Do not redraw a bee or replace the HIVE mark with the Honeybee company logo.

## Native layout and interaction contract

| Element | Proposed rule |
| --- | --- |
| Screen | 24 logical-unit gutter; 16 on compact widths; content scrolls above the pinned nav |
| Primary control | Minimum 52 high; at least 48 × 48 target; pill radius |
| Text field | 16 / 24 Manrope500, explicit label, square corners, meaningful boundary |
| Panel | 16 radius, reserved for distinct information/state; avoid nested cards |
| Navigation | Five existing text labels, selected fill + accessible state; no icon-only replacement |
| Focus | 3-unit Honey Ink on light; Soft Honey on dark; verify adjacent contrast |
| Motion | Existing 80 ms press feedback and 150 ms state fade; both zero under reduced motion |
| Large text | No scaling caps, no essential truncation, natural height; nav may wrap into multiple rows |
| Tablet | Center a readable workspace on Warm Canvas; do not invent a new navigation system |

Mockups depict 390 × 844 logical-unit viewports scaled for presentation. Phone bezel, time, and home indicator are framing only. Do not hard-code mockup coordinates or fabricate system status bars. “Design preview · Synthetic data” is an explicit specimen label, not a new live-data claim. Retain fixture isolation in QA.

Home, Requests and Help continue below the depicted viewport. Implement every existing field, including the second case status date, and preserve manual Refresh and recorded-through controls. The PDF demonstrates visual grouping, not permission to omit offscreen fields. Request-detail workspace context must come from the current authorized scope if rendered, never a route parameter or hard-coded fixture.

The existing exact help copy and role/date formatters remain authoritative for implementation. Sign-in's proposed “Welcome to HIVE” heading is presentation copy; preserve the existing authorized-email/code instructions. Account's workspace switch is visible only for authorized memberships. Support email is visible only when configured. The specimen does not introduce a preference, profile, notification, live chat, or account-deletion feature.

## State coverage Claude must implement

| State | Required behavior |
| --- | --- |
| Loading | Existing safe loading state, descriptive text, no stale workspace record behind it |
| Empty | Screen-specific explanation; retain only allowed actions |
| Read error | Existing sanitized error and safe Retry; no fabricated success |
| Offline | Preserve the app's current fail-closed data policy; no new offline cache |
| Stale scope / revoked access | Clear protected content and follow existing guard behavior |
| Request absent in scope | Keep “Request not found here”; never confirm another workspace's record |
| Sign-out in progress | Remove protected navigation while teardown completes |
| Session-storage unsafe | Keep quarantine distinct; do not introduce generic retry or render retained session data |
| Font/image unavailable | Legible bounded fallback; no infinite splash or blocked auth |

Preserve all existing status labels and prefixes in `StatusBadge`. The PDF's badge shorthand demonstrates palette and hierarchy, not approval to remove accessibility wording or state distinctions.

## Validation and status

Design artifact review passed after corrections to font identity, actual bold weights, phone-frame corners, synthetic email, and color swatches. All seven PDF pages were visually inspected. The provided normal-text color pairs were calculated using the WCAG sRGB contrast formula. See `validation.md` for the precise scope and results.

This is not WCAG certification, application QA, reconciliation evidence, or approval of a native release. Native integration, automated tests, representative devices, VoiceOver/TalkBack, largest text, landscape, small widths, offline/auth/isolation testing, and exact-build release approval remain required.

## Next implementation task

Owner: Claude, native app implementer. Target: September 8, 2026 for the first review checkpoint, an internal planning target rather than a delivery promise. Slice: shared tokens, font loading, HIVE mark, primitives, navigation, Home and Requests in both themes. Kody reviews technical evidence; Stacie reviews the client-facing feel. Continue the same system through all remaining states after the first slice is verified. No publication, store submission, developer-account changes, or new integrations are requested by this package.
