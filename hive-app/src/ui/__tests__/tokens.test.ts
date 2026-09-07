import { WCAG_AA_NON_TEXT, WCAG_AA_NORMAL_TEXT, contrastRatio } from '../contrast';
import { FONT_ASSETS } from '../fonts';
import {
  FONT_FACE_WEIGHT,
  appChrome,
  darkColors,
  fontFamily,
  inputType,
  layout,
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
    ['textDisabled on background', c.textDisabled, c.background],
    ['accent on background', c.accent, c.background],
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
    ['panelBlockedText on panelBlockedBackground', c.panelBlockedText, c.panelBlockedBackground],
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

  it('never puts light text on Honey Gold (Brand Kit v3.0 rule)', () => {
    const goldFills: [string, string][] = [
      [colors.primaryActionBackground, colors.primaryActionText],
      [colors.panelAttentionBackground, colors.panelAttentionText],
    ];
    for (const [background, text] of goldFills) {
      if (background.toUpperCase() === palette.honeyGold.toUpperCase()) {
        expect(text.toUpperCase()).toBe(palette.softBlack.toUpperCase());
      }
      expect(text.toUpperCase()).not.toBe('#FFFFFF');
    }
  });

  it('never assigns Honey Gold or Sage to a normal-text token on a light surface', () => {
    const normalTextTokens: (keyof SemanticColors)[] = [
      'textPrimary',
      'textSecondary',
      'textDisabled',
      'primaryActionText',
      'secondaryActionText',
      'panelInfoText',
      'panelStableText',
      'panelAttentionText',
      'dangerText',
      'dangerPanelText',
      'successText',
    ];
    for (const token of normalTextTokens) {
      expect(colors[token].toUpperCase()).not.toBe(palette.honeyGold.toUpperCase());
    }
    if (colors === lightColors) {
      for (const token of normalTextTokens) {
        expect(colors[token].toUpperCase()).not.toBe(palette.sage.toUpperCase());
      }
    }
  });

  it('gives a paused status its own quiet pair rather than the danger panel', () => {
    expect(colors.panelBlockedBackground).not.toBe(colors.dangerPanelBackground);
  });
});

describe('primary action per theme', () => {
  it('is Soft Black with Warm Paper text by day', () => {
    expect(lightColors.primaryActionBackground).toBe(palette.softBlack);
    expect(lightColors.primaryActionText).toBe(palette.warmPaper);
  });

  it('is Honey Gold with Soft Black text by night', () => {
    expect(darkColors.primaryActionBackground).toBe(palette.honeyGold);
    expect(darkColors.primaryActionText).toBe(palette.softBlack);
  });
});

describe('accent rules per surface', () => {
  it('is text-capable in both themes: Honey Ink on light, Honey Gold on dark', () => {
    expect(lightColors.accent).toBe(palette.honeyInk);
    expect(darkColors.accent).toBe(palette.honeyGold);
    expect(contrastRatio(lightColors.accent, lightColors.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(darkColors.accent, darkColors.background)).toBeGreaterThanOrEqual(4.5);
  });

  it('Honey Gold is never small text on the light surface', () => {
    expect(contrastRatio(palette.honeyGold, lightColors.background)).toBeLessThan(3);
  });
});

describe('app chrome', () => {
  it('is Deep Black with readable text, selected pill, and focus in both themes', () => {
    expect(appChrome.background).toBe(palette.deepBlack);
    expect(contrastRatio(appChrome.text, appChrome.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(appChrome.secondaryText, appChrome.background)).toBeGreaterThanOrEqual(
      4.5,
    );
    expect(
      contrastRatio(appChrome.selectedText, appChrome.selectedBackground),
    ).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(appChrome.focusRing, appChrome.background)).toBeGreaterThanOrEqual(3);
    // The selected pill itself must stand out from the bar (non-text 3:1).
    expect(
      contrastRatio(appChrome.selectedBackground, appChrome.background),
    ).toBeGreaterThanOrEqual(3);
  });
});

describe('type scale', () => {
  it('body and label sizes never qualify as WCAG large text (no large-text contrast discounts)', () => {
    expect(qualifiesAsLargeText(typeScale.body.fontSize, typeScale.body.fontWeight)).toBe(false);
    expect(qualifiesAsLargeText(typeScale.label.fontSize, typeScale.label.fontWeight)).toBe(false);
  });

  it('title qualifies as large text', () => {
    expect(qualifiesAsLargeText(typeScale.title.fontSize, typeScale.title.fontWeight)).toBe(true);
  });

  it('every role names a bundled Manrope face and asks for exactly that face’s weight', () => {
    const faces = new Set<string>(Object.values(fontFamily));
    for (const role of [...Object.values(typeScale), inputType]) {
      expect(faces.has(role.fontFamily)).toBe(true);
      expect(role.fontWeight).toBe(FONT_FACE_WEIGHT[role.fontFamily]);
      expect(role.lineHeight).toBeGreaterThan(role.fontSize);
    }
  });

  it('uses all five supplied weights and no synthesized ones', () => {
    const used = new Set(Object.values(typeScale).map((role) => role.fontFamily));
    expect([...used].sort()).toEqual(
      ['Manrope400', 'Manrope500', 'Manrope600', 'Manrope700', 'Manrope800'].sort(),
    );
  });

  it('matches the design specification for the five named roles', () => {
    expect(typeScale.title).toMatchObject({ fontSize: 32, lineHeight: 38, fontWeight: '700' });
    expect(typeScale.heading).toMatchObject({ fontSize: 22, lineHeight: 28, fontWeight: '700' });
    expect(typeScale.body).toMatchObject({ fontSize: 16, lineHeight: 24, fontWeight: '400' });
    expect(typeScale.label).toMatchObject({ fontSize: 16, lineHeight: 20, fontWeight: '700' });
    expect(typeScale.caption).toMatchObject({ fontSize: 14, lineHeight: 20, fontWeight: '500' });
    expect(inputType).toMatchObject({ fontSize: 16, lineHeight: 24, fontWeight: '500' });
  });
});

describe('bundled fonts', () => {
  it('registers one static asset per family name (the files themselves are checked by tests/scripts/brand-assets)', () => {
    for (const family of Object.keys(FONT_FACE_WEIGHT)) {
      expect(FONT_ASSETS[family as keyof typeof FONT_ASSETS]).toBeDefined();
    }
    expect(Object.keys(FONT_ASSETS)).toHaveLength(5);
  });
});

describe('touch targets and controls', () => {
  it('meets the 44pt iOS and 48dp Android floors on every platform', () => {
    expect(touchTarget.minHeight).toBeGreaterThanOrEqual(48);
    expect(touchTarget.minWidth).toBeGreaterThanOrEqual(48);
    expect(layout.controlMinHeight).toBeGreaterThanOrEqual(52);
    expect(layout.fieldMinHeight).toBeGreaterThanOrEqual(48);
  });
});
