import { WCAG_AA_NON_TEXT, WCAG_AA_NORMAL_TEXT, contrastRatio } from '../contrast';
import {
  darkColors,
  lightColors,
  palette,
  qualifiesAsLargeText,
  touchTarget,
  typeScale,
  type SemanticColors,
} from '../tokens';

/** Every functional pairing is measured, per theme. A failure names the pair. */
function functionalTextPairs(c: SemanticColors): [string, string, string][] {
  return [
    ['textPrimary on background', c.textPrimary, c.background],
    ['textPrimary on surface', c.textPrimary, c.surface],
    ['textSecondary on background', c.textSecondary, c.background],
    ['textSecondary on surface', c.textSecondary, c.surface],
    [
      'primaryActionText on primaryActionBackground',
      c.primaryActionText,
      c.primaryActionBackground,
    ],
    ['secondaryActionText on background', c.secondaryActionText, c.background],
    ['panelInfoText on panelInfoBackground', c.panelInfoText, c.panelInfoBackground],
    ['panelStableText on panelStableBackground', c.panelStableText, c.panelStableBackground],
    [
      'panelAttentionText on panelAttentionBackground',
      c.panelAttentionText,
      c.panelAttentionBackground,
    ],
    ['dangerText on background', c.dangerText, c.background],
    ['dangerPanelText on dangerPanelBackground', c.dangerPanelText, c.dangerPanelBackground],
    ['successText on background', c.successText, c.background],
    ['warningText on background', c.warningText, c.background],
  ];
}

function nonTextPairs(c: SemanticColors): [string, string, string][] {
  return [
    ['border on background', c.border, c.background],
    ['focusRing on background', c.focusRing, c.background],
    ['secondaryActionBorder on background', c.secondaryActionBorder, c.background],
  ];
}

describe.each([
  ['light', lightColors],
  ['dark', darkColors],
] as const)('%s theme', (_name, colors) => {
  it.each(functionalTextPairs(colors))('%s meets 4.5:1', (_label, fg, bg) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(WCAG_AA_NORMAL_TEXT);
  });

  it.each(nonTextPairs(colors))('%s meets 3:1 (non-text)', (_label, fg, bg) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(WCAG_AA_NON_TEXT);
  });

  it('gold control text is Soft Black, never white (Brand Kit v2.0 rule)', () => {
    expect(colors.primaryActionBackground.toUpperCase()).toBe(palette.honeyGold.toUpperCase());
    expect(colors.primaryActionText.toUpperCase()).toBe(palette.softBlack.toUpperCase());
    expect(colors.primaryActionText.toUpperCase()).not.toBe('#FFFFFF');
  });

  it('never assigns Honey Gold to a normal-text token', () => {
    const normalTextTokens: (keyof SemanticColors)[] = [
      'textPrimary',
      'textSecondary',
      'textDisabled',
      'primaryActionText',
      'secondaryActionText',
      'panelInfoText',
      'panelStableText',
      'dangerText',
      'dangerPanelText',
      'successText',
    ];
    for (const token of normalTextTokens) {
      expect(colors[token].toUpperCase()).not.toBe(palette.honeyGold.toUpperCase());
    }
  });
});

describe('accent rules per surface', () => {
  it('accent text is permitted on dark (>= 4.5) and non-text on light (< 3)', () => {
    expect(contrastRatio(darkColors.accent, darkColors.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(lightColors.accent, lightColors.background)).toBeLessThan(3);
  });
});

describe('type scale', () => {
  it('body text does not qualify as large text, so Rose may not carry it', () => {
    expect(qualifiesAsLargeText(typeScale.body.fontSize, typeScale.body.fontWeight)).toBe(false);
    expect(qualifiesAsLargeText(typeScale.label.fontSize, typeScale.label.fontWeight)).toBe(false);
  });

  it('title qualifies as large text', () => {
    expect(qualifiesAsLargeText(typeScale.title.fontSize, typeScale.title.fontWeight)).toBe(true);
  });

  it('uses system fonts only while the typography asset is on HOLD', () => {
    for (const variant of Object.values(typeScale)) {
      expect('fontFamily' in variant).toBe(false);
    }
  });
});

describe('touch targets', () => {
  it('meets the platform minimum (44pt iOS / 48dp Android; jest runs as iOS)', () => {
    expect(touchTarget.minHeight).toBeGreaterThanOrEqual(44);
    expect(touchTarget.minWidth).toBeGreaterThanOrEqual(44);
  });
});
