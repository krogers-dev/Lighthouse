/** Brand Kit v3.0 semantic design tokens (adopted 2026-09-07 through the
 * HIVE 2026 design package; supersedes Brand Kit v2.0 of 2026-08-21, whose
 * record stays in DESIGN.md and docs/plans as history).
 *
 * The twelve functional colors are the brand's operational palette. The
 * few DERIVED shades below exist only where a dark-theme text role would
 * otherwise be unreadable or meaning-free; they are not brand colors.
 *
 * Usage rules encoded here and enforced by __tests__/tokens.test.ts and
 * __tests__/contrast.test.ts:
 * - Soft Black carries text on Warm Paper; Warm Paper carries text on Soft
 *   Black. Deep Black is the app chrome (header and navigation) in BOTH
 *   themes, and a client's identity never recolors it.
 * - Honey Gold is a fill or accent, never small text on a light surface
 *   (1.48:1 on Warm Paper). On dark it is the primary control and the
 *   selected destination, always with Soft Black text; light text on gold
 *   is forbidden in every theme.
 * - Honey Ink is the accessible accent on light surfaces: text, focus, and
 *   the attention label on Soft Honey.
 * - Sage is secondary text on DARK only and never the sole boundary of a
 *   control; Soft Moss is a quiet rule, never a control boundary.
 * - Status meaning is never color-only (see StatusBadge and Notice).
 * Typography: Manrope, bundled as five static faces (see fonts.tsx). Every
 * role names the exact face it renders in and asks for that face's own
 * weight, so neither platform synthesizes a heavier one.
 */

export const palette = {
  softBlack: '#111310',
  deepBlack: '#0B0C0A',
  warmPaper: '#F3F2EA',
  warmCanvas: '#E7E6DD',
  honeyGold: '#E8C655',
  softHoney: '#F2DA82',
  sage: '#A6ADA0',
  softMoss: '#D7D9CF',
  honeyInk: '#684F00',
  mutedCopy: '#5B5E55',
  error: '#9D3E25',
  success: '#365B2B',
} as const;

/** Derived shades: dark-theme text roles the twelve functional colors
 * cannot carry with meaning (a danger line the same color as body text
 * says nothing at a glance), plus the quiet surface a paused status sits
 * on. Each is measured in contrast.test.ts; none is a brand color. */
export const derived = {
  darkDangerText: '#F0A9A2',
  darkSuccessText: '#A9CFA9',
  lightBlockedBackground: '#EFD9D2',
  lightBlockedText: '#7E2F1B',
  darkBlockedBackground: '#3A1E17',
  darkBlockedText: '#F0B4A6',
} as const;

export interface SemanticColors {
  /** The reading surface: Warm Paper by day, Soft Black by night. */
  background: string;
  surface: string;
  /** The surround a readable column sits on when the window is wider than
   * the column (tablet, landscape): Warm Canvas by day, Deep Black by night. */
  canvas: string;
  border: string;
  divider: string;
  textPrimary: string;
  textSecondary: string;
  textDisabled: string;
  /** Honey Ink on light (text-capable); Honey Gold on dark. */
  accent: string;
  primaryActionBackground: string;
  /** Warm Paper on Soft Black by day; Soft Black on Honey Gold by night —
   * never light text on gold. */
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
  panelBlockedBackground: string;
  panelBlockedText: string;
  dangerText: string;
  dangerPanelBackground: string;
  dangerPanelText: string;
  successText: string;
  warningText: string;
}

export const lightColors: SemanticColors = {
  background: palette.warmPaper,
  surface: palette.warmPaper,
  canvas: palette.warmCanvas,
  border: palette.mutedCopy,
  divider: palette.softMoss,
  textPrimary: palette.softBlack,
  textSecondary: palette.mutedCopy,
  textDisabled: palette.mutedCopy,
  accent: palette.honeyInk,
  primaryActionBackground: palette.softBlack,
  primaryActionText: palette.warmPaper,
  secondaryActionBorder: palette.mutedCopy,
  secondaryActionText: palette.softBlack,
  focusRing: palette.honeyInk,
  panelInfoBackground: palette.warmCanvas,
  panelInfoText: palette.softBlack,
  panelStableBackground: palette.softMoss,
  panelStableText: palette.softBlack,
  panelAttentionBackground: palette.softHoney,
  panelAttentionText: palette.honeyInk,
  panelBlockedBackground: derived.lightBlockedBackground,
  panelBlockedText: derived.lightBlockedText,
  dangerText: palette.error,
  dangerPanelBackground: palette.error,
  dangerPanelText: palette.warmPaper,
  successText: palette.success,
  warningText: palette.honeyInk,
};

export const darkColors: SemanticColors = {
  background: palette.softBlack,
  surface: palette.softBlack,
  canvas: palette.deepBlack,
  border: palette.sage,
  divider: palette.mutedCopy,
  textPrimary: palette.warmPaper,
  textSecondary: palette.sage,
  textDisabled: palette.sage,
  accent: palette.honeyGold,
  primaryActionBackground: palette.honeyGold,
  primaryActionText: palette.softBlack,
  secondaryActionBorder: palette.sage,
  secondaryActionText: palette.warmPaper,
  focusRing: palette.softHoney,
  panelInfoBackground: palette.deepBlack,
  panelInfoText: palette.warmPaper,
  panelStableBackground: palette.mutedCopy,
  panelStableText: palette.warmPaper,
  panelAttentionBackground: palette.softHoney,
  panelAttentionText: palette.honeyInk,
  panelBlockedBackground: derived.darkBlockedBackground,
  panelBlockedText: derived.darkBlockedText,
  dangerText: derived.darkDangerText,
  dangerPanelBackground: palette.error,
  dangerPanelText: palette.warmPaper,
  successText: derived.darkSuccessText,
  warningText: palette.softHoney,
};

export type ThemeName = 'light' | 'dark';

export const themes: Record<ThemeName, SemanticColors> = {
  light: lightColors,
  dark: darkColors,
};

/** The fixed HIVE chrome — header band and bottom navigation — is Deep
 * Black in both themes. Presentation only: it is never part of entity
 * data, and no client branding may override it. */
export const appChrome = {
  background: palette.deepBlack,
  text: palette.warmPaper,
  secondaryText: palette.sage,
  selectedBackground: palette.honeyGold,
  selectedText: palette.softBlack,
  focusRing: palette.softHoney,
} as const;

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

/** Layout constants from the 2026 design contract. */
export const layout = {
  /** Screen gutter, and the narrower one for compact widths. */
  screenGutter: 24,
  compactGutter: 16,
  /** Below this window width the compact gutter applies. */
  compactWidth: 360,
  /** Readable measure for the content column; wider windows show the
   * canvas either side. */
  contentMaxWidth: 720,
  /** Inputs are square; actions are pills. */
  fieldRadius: 0,
  buttonRadius: 999,
  /** Primary controls stand 52 high; fields 56; nothing tappable is
   * smaller than 48 in either dimension. */
  controlMinHeight: 52,
  fieldMinHeight: 56,
  targetMinSize: 48,
  sectionGap: 32,
  iconSize: 24,
  /** Keyboard and switch focus: a 3-unit ring just outside the control. */
  focusRingWidth: 3,
  focusRingOffset: 2,
  hairline: 1,
} as const;

/** The five bundled Manrope faces, keyed by the family name each one is
 * registered under. Each name maps to exactly ONE static file (see
 * fonts.tsx), so a role that names a face gets that face and nothing is
 * synthesized. */
export const fontFamily = {
  regular: 'Manrope400',
  medium: 'Manrope500',
  semibold: 'Manrope600',
  bold: 'Manrope700',
  extraBold: 'Manrope800',
} as const;

export type FontFamilyName = (typeof fontFamily)[keyof typeof fontFamily];
export type FontWeightValue = '400' | '500' | '600' | '700' | '800';

/** The weight each static face actually carries (its OS/2 usWeightClass).
 * A role asks for exactly this weight alongside the family, which is what
 * keeps iOS from picking a heavier trait and Android from faking bold. */
export const FONT_FACE_WEIGHT: Record<FontFamilyName, FontWeightValue> = {
  Manrope400: '400',
  Manrope500: '500',
  Manrope600: '600',
  Manrope700: '700',
  Manrope800: '800',
};

export interface TypeRole {
  readonly fontSize: number;
  readonly lineHeight: number;
  readonly fontFamily: FontFamilyName;
  readonly fontWeight: FontWeightValue;
}

/** Text roles. Sizes are logical units before the user's text scaling,
 * which is never capped (WCAG 200%). */
export const typeScale = {
  /** The HIVE wordmark in the lockup. */
  wordmark: { fontSize: 24, lineHeight: 28, fontFamily: fontFamily.extraBold, fontWeight: '800' },
  title: { fontSize: 32, lineHeight: 38, fontFamily: fontFamily.bold, fontWeight: '700' },
  heading: { fontSize: 22, lineHeight: 28, fontFamily: fontFamily.bold, fontWeight: '700' },
  subheading: { fontSize: 18, lineHeight: 24, fontFamily: fontFamily.bold, fontWeight: '700' },
  body: { fontSize: 16, lineHeight: 24, fontFamily: fontFamily.regular, fontWeight: '400' },
  bodyStrong: { fontSize: 16, lineHeight: 24, fontFamily: fontFamily.semibold, fontWeight: '600' },
  /** Control labels. */
  label: { fontSize: 16, lineHeight: 20, fontFamily: fontFamily.bold, fontWeight: '700' },
  /** Field labels and in-row labels ("Needs attention", "Next action"). */
  labelSmall: { fontSize: 14, lineHeight: 20, fontFamily: fontFamily.bold, fontWeight: '700' },
  /** Metadata: owners, dates, recorded-through. */
  caption: { fontSize: 14, lineHeight: 20, fontFamily: fontFamily.medium, fontWeight: '500' },
  captionStrong: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: fontFamily.semibold,
    fontWeight: '600',
  },
  /** The five navigation labels. */
  nav: { fontSize: 13, lineHeight: 16, fontFamily: fontFamily.bold, fontWeight: '700' },
  /** "by Honeybee Accounting" under the wordmark. */
  tagline: { fontSize: 12, lineHeight: 16, fontFamily: fontFamily.medium, fontWeight: '500' },
} as const satisfies Record<string, TypeRole>;

export type TypeVariant = keyof typeof typeScale;

/** The native text input renders body-sized Manrope Medium. */
export const inputType = {
  fontSize: 16,
  lineHeight: 24,
  fontFamily: fontFamily.medium,
  fontWeight: '500',
} as const satisfies TypeRole;

/** WCAG "large text" threshold: >=18pt (24px) regular or >=14pt (18.66px) bold. */
export function qualifiesAsLargeText(fontSize: number, fontWeight: string): boolean {
  const bold = Number(fontWeight) >= 700 || fontWeight === 'bold';
  return fontSize >= 24 || (bold && fontSize >= 18.66);
}

/** Minimum touch target on both platforms: 48 units meets the 44pt iOS
 * floor and the 48dp Android floor alike. */
export const touchTarget = {
  minHeight: layout.targetMinSize,
  minWidth: layout.targetMinSize,
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
