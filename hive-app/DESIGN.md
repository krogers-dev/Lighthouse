# DESIGN.md — Rose + Slate system for HIVE

Brand authority: the selected Rose + Slate direction in *Honeybee Web and
HIVE Selected Direction Brief*, approved 2026-08-19. A later written brand
decision supersedes it. Approved logo files, font files/licenses, app icon,
and store creative are **HOLD**: until they arrive the app uses a text-only
"HIVE" development mark, system fonts, and neutral solid-color placeholder
images (deliberately not a logo).

## Palette

| Token | Hex |
|---|---|
| Eggshell | `#FFFEFA` |
| Graphite | `#182027` |
| Rose | `#AD6670` |
| Mineral Slate | `#BFD0D7` |
| Soft Moss | `#D8E1DB` |
| Pale Rose | `#F1E2E5` |

No gold, gradients, ornamental shadows, cute bees, or invented logo.

## Semantic tokens

Implemented in `src/ui/tokens.ts` as light and dark `SemanticColors` sets.
Graphite/Eggshell carry all normal text and the primary filled control in
both themes. Rose appears only as `accent` (borders, badges, qualifying
large text). Derived shades (danger/success/warning text, dark-theme panel
surfaces) exist solely to keep measured contrast; they are not new brand
colors.

### Measured pairings (enforced by `src/ui/__tests__/contrast.test.ts` and `tokens.test.ts`)

| Pair | Ratio | Use |
|---|---:|---|
| Graphite on Eggshell | 16.32:1 | Primary light-theme text |
| Eggshell on Graphite | 16.32:1 | Dark surfaces and primary filled controls |
| Graphite on Mineral Slate | 10.37:1 | Context panels |
| Graphite on Soft Moss | 12.33:1 | Stable/complete panels |
| Rose on Eggshell | 4.24:1 | Non-text accent or qualifying large text only |
| Rose on Graphite | 3.85:1 | Non-text accent or qualifying large text only |

Every functional text pair must measure ≥ 4.5:1, every functional non-text
pair ≥ 3:1, in both themes; the test suite computes the ratios from the
actual token values, so a color change that breaks contrast fails CI. Rose
is never a normal body or standard-size button-label color, and a test
asserts no normal-text token equals Rose. Every status pairs text (or icon
plus text); no color-only meaning. Error/warning colors are contrast-passing
derived tokens.

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
