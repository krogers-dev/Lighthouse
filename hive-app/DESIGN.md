# DESIGN.md — Brand Kit v2.0 system for HIVE

Brand authority: **Brand Kit v2.0**, adopted 2026-08-21, superseding the
Rose + Slate direction of 2026-08-19 (whose dated execution record remains
in docs/plans as history). A later written brand decision supersedes this
one. The approved Concept 02 HIVE mark, its provenance, clear-space rules,
and platform exports land only after asset QA — never redrawn from a
screenshot. Until then the app uses a text-only "HIVE" development mark,
system fonts, and neutral solid-color placeholder images (deliberately not
a logo).

## Palette

| Token       | Hex       |
| ----------- | --------- |
| Soft Black  | `#0A0B0A` |
| Honey Gold  | `#EEA723` |
| Warm Amber  | `#F5BC49` |
| Wax White   | `#F4E4CD` |
| Clean White | `#FFFFFF` |
| Muted Stone | `#6C6B66` |

No gradients, ornamental shadows, cute bees, or invented logo.

## Semantic tokens

Implemented in `src/ui/tokens.ts` as light and dark `SemanticColors` sets.
Soft Black carries text on light surfaces; Clean White on dark. Honey Gold
is the primary filled control and the accent in both themes, always with
Soft Black control text. Warm Amber carries attention panels. Derived
shades (secondary text `#5B5A55`, borders, status colors, dark surfaces)
exist solely to keep measured contrast; they are not new brand colors.

### Measured pairings (enforced by `src/ui/__tests__/contrast.test.ts` and `tokens.test.ts`)

| Pair                      |   Ratio | Use                                                    |
| ------------------------- | ------: | ------------------------------------------------------ |
| Soft Black on Wax White   | 15.80:1 | Primary light-theme text                               |
| Soft Black on Clean White | 19.72:1 | Text on cards                                          |
| Clean White on Soft Black | 19.72:1 | Primary dark-theme text                                |
| Soft Black on Honey Gold  |  9.56:1 | Gold control text (the only allowed gold text pairing) |
| Honey Gold on Soft Black  |  9.56:1 | Accent text on dark surfaces                           |
| Soft Black on Warm Amber  | 11.43:1 | Attention panels                                       |
| Clean White on Honey Gold |  2.06:1 | **Forbidden** — never white text on gold               |
| Honey Gold on Wax White   |  1.65:1 | Non-text accent only on light surfaces                 |

Every functional text pair must measure ≥ 4.5:1 and every functional
non-text pair ≥ 3:1 in both themes; the tests compute ratios from the
actual token values, so a change that breaks contrast fails CI. Tests also
assert that gold control text is Soft Black in both themes and that Honey
Gold is never a normal-text token. Every status pairs text (or icon plus
text); no color-only meaning.

## Typography

System fonts only (typography asset HOLD). Scale: title 28/34·600,
heading 22/28·600, body 17/24·400, label 15/20·600, caption 13/18·400.
`allowFontScaling` stays on and no primitive caps scaling below the WCAG
200% requirement; layout absorbs growth (scrolling screens, no fixed-height
text containers).

## Components and states

Primitives live in `src/ui/primitives/`: Screen, AppText, Button,
TextField, StatusBadge, Notice, LoadingState, EmptyState, ErrorState,
OfflineState, QuarantineState. Every control has a role, a persistent
label, focus and press states, a disabled state, large-text behavior, and a
platform-size touch target (44pt iOS / 48dp Android, enforced in tokens and
tests).

Every feature screen must be able to show its explicit states: loading,
empty, offline, denied, stale, success, failure, and quarantine. The
dashboard demonstrates all of them in Milestone 0.

## Navigation

Expo Router with thin routes in `app/`. One primary action per screen,
persistent labels, progressive disclosure, safe back/cancel. Client V1
navigation is at most five destinations (Home, Requests, Activity, Help,
Account); Milestone 0 ships the auth flow, scope selection, dashboard
(Home), and account/settings only. Staff routes do not exist in the client
binary.

## Responsive behavior

Portrait and landscape both supported (`orientation: "default"`). Screens
scroll; content column is capped at a readable 720pt measure on tablets.
Phone and tablet, small and large, light and dark are all in the QA matrix.

## Motion

- No animation on frequent navigation or keyboard-driven actions.
- Motion only for spatial continuity, state indication, explanation,
  feedback, or avoiding a jarring change.
- Press feedback is immediate and layout-stable (opacity only).
- Transform/opacity only for nonessential motion; animations interruptible;
  correctness never depends on completion callbacks.
- Under reduced motion, positional motion is removed; only brief
  opacity/color feedback that aids comprehension remains
  (`motion.durationsUnderReducedMotion`).

## Screenshot QA

Every checkpoint that has a device lane captures: small phone, large phone,
tablet; portrait and landscape; light and dark; 200% text; the full state
set above. Screenshots contain synthetic data only — clearly fictional
labels and `example.invalid` emails — and are checked by the same excluded-
fields rules as logs (docs/data-classification.md). In this environment the
device lane is HOLD; the checklist stands for when a device lane exists.
