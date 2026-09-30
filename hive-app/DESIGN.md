# DESIGN.md — Brand Kit v3.0 system for HIVE

Brand authority: **Honeybee Brand Kit v3.0** (effective 2026-08-21,
approved by Kody Rogers) together with the **HIVE honeycomb product mark**
supplied and approved 2026-08-25, adopted for the native app on 2026-09-07
through the HIVE 2026 design package
(`docs/design/2026-09-07-hive-2026-design-package/`). This supersedes the
Brand Kit v2.0 system of 2026-08-21, whose record is kept at the end of
this file, and the Rose + Slate direction of 2026-08-19 (docs/plans). A
later written brand decision supersedes this one.

The package is a design draft for implementation and review. Store icon
masters, splash artwork QA on device, signing, submission, and release stay
HOLD.

## Palette

| Role        | Hex       | Use                                                          |
| ----------- | --------- | ------------------------------------------------------------ |
| Soft Black  | `#111310` | Text on light; the night reading surface                     |
| Deep Black  | `#0B0C0A` | Header band and navigation, both themes; night canvas        |
| Warm Paper  | `#F3F2EA` | The day reading surface; text on dark                        |
| Warm Canvas | `#E7E6DD` | The surround on wide windows; the quiet info panel by day    |
| Honey Gold  | `#E8C655` | Fill and accent: selected destination, night primary control |
| Soft Honey  | `#F2DA82` | Attention panel; focus on dark                               |
| Sage        | `#A6ADA0` | Secondary text on dark only; chrome secondary text           |
| Soft Moss   | `#D7D9CF` | Rules and settled-state panel by day                         |
| Honey Ink   | `#684F00` | Accessible accent, focus, and attention text on light        |
| Muted Copy  | `#5B5E55` | Secondary text and control boundaries by day                 |
| Error       | `#9D3E25` | Danger text on paper; the danger panel                       |
| Success     | `#365B2B` | Success text on paper                                        |

Derived shades (not brand colors; each exists only for measured contrast
where a dark-theme text role would otherwise carry no meaning): dark danger
text `#F0A9A2`, dark success text `#A9CFA9`, and the paused-status pair
(`#EFD9D2` / `#7E2F1B` by day, `#3A1E17` / `#F0B4A6` by night).

No gradients outside the approved artwork, no ornamental shadows, no
honeycomb wallpaper, no glass panels, no metric cards, no invented logo.

## Semantic tokens

Implemented in `src/ui/tokens.ts` as light and dark `SemanticColors` sets
plus one theme-independent `appChrome` object. The chrome is Deep Black in
both themes and a client's identity never recolors it. Day content is Warm
Paper with Soft Black text; night content is Soft Black with Warm Paper
text. The primary control is Soft Black / Warm Paper by day and Honey Gold /
Soft Black by night; light text never sits on gold.

### Measured pairings (enforced by `src/ui/__tests__/contrast.test.ts` and `tokens.test.ts`)

| Pair                            |            Ratio | Use                                              |
| ------------------------------- | ---------------: | ------------------------------------------------ |
| Soft Black on Warm Paper        |          16.63:1 | Primary light text; day primary control          |
| Warm Paper on Soft Black        |          16.63:1 | Primary dark text                                |
| Muted Copy on Warm Paper        |           5.89:1 | Secondary light text; field boundary             |
| Sage on Soft Black              |           8.10:1 | Secondary dark text; dark field boundary         |
| Soft Black on Honey Gold        |          11.24:1 | Night primary control; selected destination      |
| Honey Ink on Soft Honey         |           5.59:1 | Attention label                                  |
| Honey Ink on Warm Paper         |           6.91:1 | Accent, focus, warning on light                  |
| Soft Black on Soft Moss         |          13.09:1 | Settled state by day                             |
| Warm Paper on Muted Copy        |           5.89:1 | Settled state by night                           |
| Error on Warm Paper             |           5.94:1 | Danger text by day                               |
| Warm Paper on Error             |           5.94:1 | Danger panel, both themes                        |
| Success on Warm Paper           |           6.96:1 | Success text by day                              |
| Soft Honey on Soft Black        |          13.45:1 | Warning text and focus by night                  |
| Warm Paper / Sage on Deep Black | 17.46:1 / 8.50:1 | Chrome text                                      |
| Warm Paper on Honey Gold        |           1.48:1 | **Forbidden** — never light text on gold         |
| Honey Gold on Warm Paper        |           1.48:1 | Fill only on light surfaces, never small text    |
| Sage on Warm Paper              |           2.05:1 | Decorative on light; never text or sole boundary |

Every functional text pair must measure ≥ 4.5:1 and every functional
non-text pair ≥ 3:1 in both themes; the tests compute ratios from the
actual token values, so a change that breaks contrast fails CI. Every status
pairs a word (and glyph) with its color; no color-only meaning.

## Typography

Manrope is the only interface family, bundled as five static faces under
the SIL Open Font License (`assets/fonts/Manrope-400.ttf` … `-800.ttf`,
`OFL.txt`, `Font-Source-Notice.txt`). `src/ui/fonts.tsx` registers each
file under its own family name (`Manrope400` … `Manrope800`) at launch and
every text role names the exact face it renders in together with that
face's own weight, so neither platform synthesizes a heavier one. Loading
is bounded: after 3 s (or on failure) the app proceeds on system fonts at
the same sizes and weights, and switches to Manrope if the faces arrive
later. Typography never gates authentication or data.

Scale (size / line height · weight · face): wordmark 24/28·800, title
32/38·700, heading 22/28·700, subheading 18/24·700, body 16/24·400, body
strong 16/24·600, label 16/20·700, small label 14/20·700, caption
14/20·500, caption strong 14/20·600, nav 13/16·700, tagline 12/16·500;
the native text input is 16/24·500. `allowFontScaling` stays on and no
primitive caps scaling below the WCAG 200% requirement; layout absorbs
growth (scrolling screens, wrapping navigation, no fixed-height text
containers).

## Identity

The header band carries the lockup: the approved mark (`src/ui/primitives/
BrandHeader.tsx`, 46 wide at the artwork's 512:460 ratio, `resizeMode`
contain, no backing shape, tile, border, or shadow) beside **HIVE** and
"by Honeybee Accounting". The image is decorative next to the words and is
hidden from assistive technology; if it fails to load the lockup is the
words alone. Never redraw the mark, never substitute the company bee, never
let a client's identity replace the chrome. `tests/scripts/brand-assets`
holds the tracked bytes to the package manifest; `scripts/brand-icons.mjs`
derives the native icon set from the same file and
`tests/scripts/brand-icons` holds the tree to that derivation.

## Layout and controls

Screen gutter 24 (16 below 360 wide); the reading column is capped at 720
and sits on the canvas color on wider windows. The header band and the
bottom navigation are pinned chrome above and below the scroll area, and
own the top and bottom safe areas. Primary controls are 52 high pills; text
fields are 56 high with square corners and a real boundary; nothing
tappable is under 48 in either dimension. Panels (notices, the setup key)
use a 16 radius and are reserved for a distinct piece of information or a
protected state; lists use thin rules, not nested cards. Keyboard and
switch focus is a 3-unit ring just outside the control (Honey Ink on light,
Soft Honey on dark and on the chrome).

## Components and states

Primitives live in `src/ui/primitives/`: Screen, BrandHeader, AppText,
Button, TextField, StatusBadge, Notice, LoadingState, EmptyState,
ErrorState, OfflineState, QuarantineState. Every control has a role, a
persistent label, focus and press states, a disabled state, large-text
behavior, and a platform-size touch target (enforced in tokens and tests).
Every feature screen must be able to show its explicit states: loading,
empty, offline, denied, stale scope, expired, error, and quarantine.

## Navigation

Expo Router with thin routes in `app/`. Five persistent, labeled
destinations (Home, Requests, Activity, Help, Account) on the Deep Black
bar; the current one is a filled Honey Gold pill with Soft Black text and
`accessibilityState.selected`, never color alone. One primary action per
screen, progressive disclosure, safe back/cancel. The nav renders only
while authorized and disappears during sign-out.

## Responsive behavior

Portrait and landscape both supported (`orientation: "default"`). Screens
scroll; the column is capped at a readable 720 measure; the navigation
wraps into a second row at large text rather than truncating. Phone and
tablet, small and large, light and dark are all in the QA matrix.

## Motion

- No animation on frequent navigation or keyboard-driven actions.
- Press feedback is immediate and layout-stable (opacity only, 80 ms);
  state fades are 150 ms.
- Under reduced motion both are zero (`motion.durationsUnderReducedMotion`).

## Screenshot QA

Every checkpoint that has a device lane captures: small phone, large phone,
tablet; portrait and landscape; light and dark; 200% text; the full state
set above. Screenshots contain synthetic data only — clearly fictional
labels and `example.invalid` emails — and are checked by the same excluded-
fields rules as logs (docs/data-classification.md).

---

## Superseded record: Brand Kit v2.0 (2026-08-21 to 2026-09-07)

Kept verbatim as the decision record of the system this one replaced.

Brand authority was Brand Kit v2.0, adopted 2026-08-21, superseding the
Rose + Slate direction of 2026-08-19. The approved Concept 02 HIVE mark, its
provenance, clear-space rules, and platform exports were to land only after
asset QA; until then the app used a text-only "HIVE" development mark,
system fonts, and neutral solid-color placeholder images.

Palette: Soft Black `#0A0B0A`, Honey Gold `#EEA723`, Warm Amber `#F5BC49`,
Wax White `#F4E4CD`, Clean White `#FFFFFF`, Muted Stone `#6C6B66`. Soft
Black carried text on light surfaces; Clean White on dark. Honey Gold was
the primary filled control and the accent in both themes, always with Soft
Black control text (white on gold forbidden at 2.06:1). Warm Amber carried
attention panels.

Measured pairings then enforced: Soft Black on Wax White 15.80:1; Soft
Black on Clean White 19.72:1; Clean White on Soft Black 19.72:1; Soft Black
on Honey Gold 9.56:1; Honey Gold on Soft Black 9.56:1; Soft Black on Warm
Amber 11.43:1; Clean White on Honey Gold 2.06:1 (forbidden); Honey Gold on
Wax White 1.65:1 (non-text only).

Typography: system fonts only (typography asset HOLD); scale title
28/34·600, heading 22/28·600, body 17/24·400, label 15/20·600, caption
13/18·400.
