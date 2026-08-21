/** Rose + Slate semantic design tokens.
 *
 * Brand palette per the approved direction (2026-08-19). Rules encoded here
 * and enforced by __tests__/tokens.test.ts:
 * - Graphite/Eggshell carry normal text and primary filled controls.
 * - Rose is an accent or qualifying large text only, never normal text.
 * - Every status rendering pairs text or icon-plus-text; color alone never
 *   carries meaning (see StatusBadge).
 * - No gold, gradients, ornamental shadows, or invented logo assets.
 * Typography: system fonts only until approved assets arrive (asset HOLD).
 */
import { Platform } from 'react-native';

export const palette = {
  eggshell: '#FFFEFA',
  graphite: '#182027',
  rose: '#AD6670',
  slate: '#BFD0D7',
  moss: '#D8E1DB',
  paleRose: '#F1E2E5',
} as const;

export interface SemanticColors {
  background: string;
  surface: string;
  border: string;
  divider: string;
  textPrimary: string;
  textSecondary: string;
  textDisabled: string;
  /** Accent for non-text elements and qualifying large text only. */
  accent: string;
  primaryActionBackground: string;
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
  background: palette.eggshell,
  surface: '#FFFFFF',
  border: '#7E8992',
  divider: '#D9DDE0',
  textPrimary: palette.graphite,
  textSecondary: '#46525B',
  textDisabled: '#6B747B',
  accent: palette.rose,
  primaryActionBackground: palette.graphite,
  primaryActionText: palette.eggshell,
  secondaryActionBorder: palette.graphite,
  secondaryActionText: palette.graphite,
  focusRing: palette.graphite,
  panelInfoBackground: palette.slate,
  panelInfoText: palette.graphite,
  panelStableBackground: palette.moss,
  panelStableText: palette.graphite,
  panelAttentionBackground: palette.paleRose,
  panelAttentionText: palette.graphite,
  dangerText: '#8A2430',
  dangerPanelBackground: '#F8E4E6',
  dangerPanelText: '#701D27',
  successText: '#2A5D3C',
  warningText: '#77500F',
};

export const darkColors: SemanticColors = {
  background: palette.graphite,
  surface: '#202A33',
  border: '#5F6B74',
  divider: '#39434C',
  textPrimary: palette.eggshell,
  textSecondary: '#B9C4CC',
  textDisabled: '#7E8890',
  accent: palette.rose,
  primaryActionBackground: palette.eggshell,
  primaryActionText: palette.graphite,
  secondaryActionBorder: palette.eggshell,
  secondaryActionText: palette.eggshell,
  focusRing: palette.eggshell,
  panelInfoBackground: '#2B3843',
  panelInfoText: palette.eggshell,
  panelStableBackground: '#25332C',
  panelStableText: palette.eggshell,
  panelAttentionBackground: '#3A2B30',
  panelAttentionText: palette.eggshell,
  dangerText: '#F2A7B0',
  dangerPanelBackground: '#3D2226',
  dangerPanelText: '#F5C2C8',
  successText: '#9FD3B0',
  warningText: '#E3C285',
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

/** System fonts only; fontFamily deliberately unset (typography asset HOLD). */
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
