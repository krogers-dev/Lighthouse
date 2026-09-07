# HIVE native repository design reference

Status: Read-only source review complete. Design recommendation only; native implementation and release remain subject to their own gates. No application tests were executed by this review.

## Verified source

- Repository: krogers-dev/Lighthouse.
- Branch: claude/hive-fable-5-greenfield-p0cwkq.
- Observed head: ca961818b68321791ab8b8de4b0bd345bb428999.
- App root: hive-app/. The quoted src/ui/tokens.ts link omitted this prefix and returned 404.
- Exact source copies and blob hashes are retained with provenance.json.
- This native app is distinct from the published Sites HIVE website. Do not transfer website build/test claims to this branch.
- DESIGN.md, CLAUDE.md, README.md, and tokens.ts still cite Brand Kit v2.0 and hold typography and the Concept 02 mark for asset QA.
- DESIGN.md explicitly permits a later written brand decision to supersede it.
- No AGENTS.md exists at the repository root or hive-app root; no AGENTS.md was present in the recursively inspected hive-app tree.

## Architecture and scope

Expo 57.0.20, Expo Router 57.0.19, React 19.2.3, React Native 0.86.3, TypeScript 6.0.3. Node 22.23.2 and npm 10.9.8 are exact pins. Existing react-native-svg 15.15.4 can support a small approved icon set without adding a UI framework. Manrope/font loading is not currently implemented.

Five destinations: Home, Requests, Activity, Help, Account. Milestone 1 is read-only. No upload, respond, edit, approval, payment, account-deletion, financial chart, notification, or live-sync control is authorized by these views. Sign-in and sign-out retain their existing auth behavior.

The app tree contains 13 route modules excluding _layout.tsx; ten dedicated feature/auth/tenancy View files; four feature Screen wrappers; and three shared feature components. These overlap in user journeys. Do not repeat “27 screens” as a newly verified screen count.

Protected views use AuthorizedScreen -> Screen (scroll content + pinned footer) -> PrimaryNav. The footer is deliberately pinned and disappears during sign-out. Data loading and scope invalidation live elsewhere and remain untouched.

## Change map

| Area | Existing files below hive-app/ | Design boundary |
| --- | --- | --- |
| Color, spacing, scale, radii, motion | src/ui/tokens.ts, src/ui/theme.ts | Keep semantic names; system light/dark choice |
| Seven primitive files | src/ui/primitives/AppText.tsx, Button.tsx, TextField.tsx, Notice.tsx, Screen.tsx, StatusBadge.tsx, states.tsx | Preserve props, testIDs, accessibility and safe actions |
| Main navigation | src/features/shared/PrimaryNav.tsx | Preserve five text labels, selected state, pinned footer, no color-only selection |
| Authenticated shell | src/features/shared/AuthorizedScreen.tsx | Preserve route guard and sign-out behavior |
| Home | src/features/dashboard/DashboardView.tsx | Case status, attention, next action, owner; refresh |
| Requests | src/features/requests/RequestsView.tsx | Tappable request rows; no response/upload action |
| Request detail | src/features/requests/RequestDetailView.tsx | Read detail; back to requests |
| Activity | src/features/activity/ActivityView.tsx | Event kind, role and server date only |
| Help | src/features/help/HelpView.tsx | Static help; support link only when configured |
| Account | src/features/settings/SettingsView.tsx | Current workspace, access notice, conditional workspace switch, sign-out and back |
| Sign-in | src/auth/views/SignInView.tsx | Email field and Send code; no self-registration |
| Workspace choice | src/tenancy/views/ScopeChooserView.tsx | Server-confirmed memberships, select by membership ID |
| Native assets/config | assets/images/*, app.json | Current placeholders and hard-coded native background colors need review |
| Authority docs | DESIGN.md, CLAUDE.md, README.md | Add explicit v3/honeycomb/Manrope source references; preserve historical record |
| Tests | src/ui/__tests__/*; feature/view and shared accessibility tests | Update stale typography/brand assertions; preserve behavior checks |

Centralization makes this manageable. A complete font/logo/nav refresh is more than a one-file token change. AppText currently picks fontSize, lineHeight and fontWeight individually, so adding fontFamily to typeScale alone has no effect. TextField separately styles the native TextInput and also needs the approved font family. tokens.test.ts currently asserts that fontFamily does not exist. app.json separately hard-codes splash and adaptive-icon backgrounds.

## Token mapping

Use only tokens.reference.ts in this package for the proposed palette and theme mapping. It matches the PDF and supersedes any interim mapping from repository review.



## Smallest useful implementation slice

1. Record the current v3 source and approved August 25 HIVE honeycomb mark as the new design authority, distinguishing Honeybee's bee logo from HIVE's app mark. Preserve retired authority records.
2. Implement v3 semantic colors plus approved bundled Manrope in the two native text primitives. Add the exact master HIVE asset and fallback with local static loading; do not redraw its geometry. Keep icon-store release separate until platform asset QA passes.
3. Restyle the seven primitives and shared PrimaryNav without changing API props, actions, route guards, membership logic, or data repositories.
4. Apply the reviewed Home and Requests layouts using existing props and fixtures. Keep unsupported future functions out of this release.
5. Run type/lint/contrast/primitives/feature/navigation/scope-denial checks, export, and device screenshots. Inspect 200% text, light/dark, phone/tablet, landscape, focus, keyboard, VoiceOver/TalkBack, offline, expiry, denied, stale scope and quarantine.
6. Carry the approved pattern to Activity, Help, Account, sign-in and remaining states. Report new evidence at the appropriate checkpoint level. No inherited test counts or release PASS.

## Verified fixture content for mockups

All content remains explicitly synthetic. Exact fixture extracts are in synthetic-screen-content.json and the retained test files.

Home uses Harbor Light Bakery LLC (Synthetic), 2025 books close (Synthetic), Waiting on documents, One statement is still needed (Synthetic), Provide the missing statement (Synthetic), Owner: You, and Status changed August 21, 2026. A second case is Prior year wrap-up (Synthetic), Approved, July 2, 2026. “Recorded through” uses source data, never the device clock.

Requests use Bank statement for the closing month (Synthetic), Needs a response, Owner: You, requested August 10, due September 10, 2026; and Confirm the vehicle expense category (Synthetic), Answered, requested August 5, 2026. Request detail reads “The final month statement is needed to complete the records (Synthetic).”

Activity shows Request answered by You on August 11, 2026 and Status changed by Your preparer on August 1, 2026. No personal names, filenames or financial values.

Account does not render the supplied email prop. Show current workspace and access information; conditional support address only if configured. No invented notification/preferences/security-settings menus.

Sign-in heading HIVE; body “Sign in with your authorized email. We will send a sign-in code.”; persistent Email label; Send code primary action. Use an example.invalid value only if showing an entered email in a mockup.

Help content version 1.1.0 dated September 7, 2026 is in HelpView.tsx. Preserve the present limitation: responses and documents are handled through the user's existing Honeybee channel. No invented chat, upload or booking experience.

