/** Brand Kit v2.0 semantic design tokens (adopted 2026-08-21; supersedes
 * the Rose + Slate direction, which is retained only as historical record
 * in docs/plans).
 *
 * Palette: Soft Black #0A0B0A, Honey Gold #EEA723, Warm Amber #F5BC49,
 * Wax White #F4E4CD, Clean White #FFFFFF, Muted Stone #6C6B66.
 *
 * Usage rules encoded here and enforced by __tests__/tokens.test.ts:
 * - Soft Black carries text on light surfaces; Clean White on dark.
 * - Honey Gold is the primary control surface and accent. Gold control
 *   text is ALWAYS Soft Black — white text on Honey Gold is forbidden
 *   (measured 2.06:1).
 * - On light surfaces Honey Gold is non-text only (1.65:1 on Wax White);
 *   on dark surfaces it may serve as accent text (9.56:1 on Soft Black).
 * - Derived shades (secondary text, borders, status colors) exist solely
 *   to keep measured WCAG contrast and are not new brand colors.
 * - Status meaning is never color-only (see StatusBadge).
 * Typography: system fonts only; the approved Concept 02 asset arrives
 * only after asset QA (never redrawn from a screenshot) — until then the
 * development mark stays text-only.
 */
import { Platform } from 'react-native';

export const palette = {
  softBlack: '#0A0B0A',
  honeyGold: '#EEA723',
  warmAmber: '#F5BC49',
  waxWhite: '#F4E4CD',
  cleanWhite: '#FFFFFF',
  mutedStone: '#6C6B66',
} as const;

export interface SemanticColors {
  background: string;
  surface: string;
  border: string;
  divider: string;
  textPrimary: string;
  textSecondary: string;
  textDisabled: string;
  /** Honey Gold: non-text on light surfaces; accent text allowed on dark. */
  accent: string;
  primaryActionBackground: string;
  /** Always Soft Black on gold — never white (Brand Kit v2.0 rule). */
  primaryActionText: string;
  secondaryActionBorder: string;
  secondaryActionText: string;
  focusRing: string;
  panelInfoBackground: string;
  panelInfoText: string;
  panelStableBackground: string;
  panelStableText: string;
  panelAttentionBackground: string;
  panelAttentionText: string;
  dangerText: string;
  dangerPanelBackground: string;
  dangerPanelText: string;
  successText: string;
  warningText: string;
}

export const lightColors: SemanticColors = {
  background: palette.waxWhite,
  surface: palette.cleanWhite,
  border: '#857E6F',
  divider: '#E3D3B9',
  textPrimary: palette.softBlack,
  textSecondary: '#5B5A55',
  textDisabled: palette.mutedStone,
  accent: palette.honeyGold,
  primaryActionBackground: palette.honeyGold,
  primaryActionText: palette.softBlack,
  secondaryActionBorder: palette.softBlack,
  secondaryActionText: palette.softBlack,
  focusRing: palette.softBlack,
  panelInfoBackground: '#F9F1E3',
  panelInfoText: palette.softBlack,
  panelStableBackground: '#EBD9BC',
  panelStableText: palette.softBlack,
  panelAttentionBackground: palette.warmAmber,
  panelAttentionText: palette.softBlack,
  dangerText: '#8A2430',
  dangerPanelBackground: '#F6D9CD',
  dangerPanelText: '#701D27',
  successText: '#2F5D3A',
  warningText: '#6E4A00',
};

export const darkColors: SemanticColors = {
  background: palette.softBlack,
  surface: '#16150F',
  border: '#8A8377',
  divider: '#262419',
  textPrimary: palette.cleanWhite,
  textSecondary: '#C9C4B4',
  textDisabled: '#8A8377',
  accent: palette.honeyGold,
  primaryActionBackground: palette.honeyGold,
  primaryActionText: palette.softBlack,
  secondaryActionBorder: palette.cleanWhite,
  secondaryActionText: palette.cleanWhite,
  focusRing: palette.cleanWhite,
  panelInfoBackground: '#221F15',
  panelInfoText: palette.cleanWhite,
  panelStableBackground: '#20211A',
  panelStableText: palette.cleanWhite,
  panelAttentionBackground: '#3A2C08',
  panelAttentionText: palette.warmAmber,
  dangerText: '#F0A9A2',
  dangerPanelBackground: '#33150F',
  dangerPanelText: '#F4C1B8',
  successText: '#A9CFA9',
  warningText: palette.warmAmber,
};

export type ThemeName = 'light' | 'dark';

export const themes: Record<ThemeName, SemanticColors> = {
  light: lightColors,
  dark: darkColors,
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

export const radii = {
  sm: 6,
  md: 10,
  lg: 16,
} as const;

/** System fonts only; fontFamily deliberately unset (approved brand fonts
 * arrive with asset QA). */
export const typeScale = {
  title: { fontSize: 28, lineHeight: 34, fontWeight: '600' },
  heading: { fontSize: 22, lineHeight: 28, fontWeight: '600' },
  body: { fontSize: 17, lineHeight: 24, fontWeight: '400' },
  label: { fontSize: 15, lineHeight: 20, fontWeight: '600' },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
} as const;

export type TypeVariant = keyof typeof typeScale;

/** WCAG "large text" threshold: >=18pt (24px) regular or >=14pt (18.66px) bold. */
export function qualifiesAsLargeText(fontSize: number, fontWeight: string): boolean {
  const bold = Number(fontWeight) >= 700 || fontWeight === 'bold';
  return fontSize >= 24 || (bold && fontSize >= 18.66);
}

/** Platform minimum touch target: 44pt iOS, 48dp Android. */
export const touchTarget = {
  minHeight: Platform.select({ ios: 44, android: 48, default: 44 }) as number,
  minWidth: Platform.select({ ios: 44, android: 48, default: 44 }) as number,
} as const;

/** Motion explains state, stays interruptible, and reduces on request.
 * Only opacity/color feedback survives reduced motion. */
export const motion = {
  pressFeedbackMs: 80,
  stateFadeMs: 150,
  durationsUnderReducedMotion: {
    pressFeedbackMs: 0,
    stateFadeMs: 0,
  },
} as const;
