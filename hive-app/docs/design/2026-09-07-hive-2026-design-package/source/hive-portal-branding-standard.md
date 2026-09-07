# Honeybee Hive brand and interface standard

## Authority and status

Honeybee Brand Kit v3.0, Concept 02, approved by Kody Rogers on August 21, 2026, governs the HIVE interface and replaces the former Rose + Slate system. The HIVE honeycomb mark supplied and approved by Kody Rogers on August 25, 2026, is the product identity authority and replaces the Honeybee profile bee on every HIVE product surface. This standard governs the web demonstration, authentication email, PWA, and native foundation without changing any authentication, tenant-isolation, ledger, review, or release control.

The first natural-language reference is **Honeybee Hive**. Use **HIVE** for the standalone product name. The application lockup is **HIVE** with **by Honeybee Accounting**.

## Operational palette

| Role | Value |
|---|---|
| Soft Black | `#111310` |
| Deep Black | `#0B0C0A` |
| Warm Paper | `#F3F2EA` |
| Warm Canvas | `#E7E6DD` |
| Honey Gold | `#E8C655` |
| Soft Honey | `#F2DA82` |
| Sage | `#A6ADA0` |
| Soft Moss | `#D7D9CF` |
| Honey Ink | `#684F00` |
| Muted Copy | `#5B5E55` |
| Error | `#9D3E25` |
| Success | `#365B2B` |

Soft Black is primary copy. Deep Black is for dark panels and primary controls. Warm Paper is the primary surface and Warm Canvas is the surrounding canvas. Honey Ink is the accessible accent for text and focus. Honey Gold is an accent or fill, not small text on a light surface. Muted Copy is secondary text. Sage is decorative and never the sole text or control-boundary color. Soft Moss is a quiet surface boundary; interactive fields use Muted Copy when a stronger boundary is needed.

## Typography

Manrope is the only HIVE interface family. Web uses the self-hosted variable font. Native loads static Manrope 400, 500, 700, and 800 faces. Use regular for body copy, medium for labels, bold for headings and controls, and extra bold for the wordmark or primary financial figures. Do not synthesize client typography across the application shell.

## Identity assets

Only current v3 logo files in `public/brand/` may represent Honeybee Accounting. The fixed header uses the approved source-faithful HIVE product mark in `public/brand/hive-product-mark.png` with the HIVE lockup. Scalable and transparent derivatives are `hive-mark-primary.svg`, `hive-mark-primary-64.png`, `hive-mark-primary-180.png`, and `hive-mark-primary-512.png`. Honeybee company identity remains distinct. The favicon, touch icon, PWA, native icon, splash, metadata, email, and social preview must use the HIVE mark and current naming.

The HIVE social card approved by Kody for web publication is `public/og.png`, with its editable vector source at `public/brand/hive-social-preview.svg`. It uses the HIVE mark and the message **Financial clarity, kept in view.** The general Honeybee company preview remains available for company-level use but is not the HIVE product card.

## Product and client identity

HIVE chrome is always Honeybee branded. Client identity is bounded to the entity context mark beside the workspace selector. A client logo, initials, or approved colors must never replace the HIVE header, navigation, typography, status strip, primary controls, or full-shell palette. Switching entities must not leave the prior entity's identity visible.

When no approved client asset exists, derive neutral initials from the entity name and render them inside the bounded mark. Do not invent a client logo or use the brand of a customer, vendor, league, franchisor, or other related organization.

## Interface rules

- Use Warm Canvas outside and Warm Paper inside the application surface.
- Use flat color fields, normal 16-pixel card radii, restrained shadows, and no decorative interface gradients. The approved tonal finish inside the HIVE identity artwork is the only standing brand-mark exception. Functional progress indicators may use a conic gradient.
- Keep controls at least 44 CSS pixels on web and 48 points on native.
- Use Honey Ink for focus on light surfaces and Soft Honey for focus on Deep Black surfaces.
- Preserve readable contrast. Sage is not body text, placeholder text, or the sole boundary of an interactive control.
- HIVE key art is editorial and campaign art. It is not literal product UI, a dashboard screenshot, or an application wallpaper.
- Provide a static fallback for motion and honor reduced-motion preferences.

## Visible data and safety states

The public HIVE experience is a controlled demonstration using simulated data. It must continuously identify the selected example entity, **Simulated data**, and **Not client records**. Never imply that QuickBooks is connected or that financial records are current when the state is simulated.

For a live workspace, source, freshness, review status, and provisional status remain visible. Before connected information is available, use **Not available yet**, never demonstration figures. The visual system does not change the required prepare, reconcile, quality-control, approval, release, lock, audit, tenant-isolation, or MFA boundaries.

## Native release boundary

The exact HIVE identity artwork is approved for app-icon use. The repository contains an opaque 1024-pixel Apple and store master, an Android adaptive foreground with an opaque Soft Black background, a monochrome themed-icon layer, splash artwork, and PWA derivatives. The missing-artwork gate is **PASS** for identity and packaging only. Native store release remains **HOLD** until the exact shipping build completes representative-device, mask, appearance, accessibility, privacy, listing, and reviewer-package QA, followed by approval of the exact build and destination.

## Release checks

Before publishing, verify current HIVE asset hashes, alpha and opacity requirements, Apple and Android mask previews, metadata and manifest paths, HIVE casing, Manrope loading, contrast, keyboard focus, reduced motion, bounded client identity, persistent simulated-data labels, and the absence of retired Rose + Slate tokens. Record the approver and release evidence with the deployment.
