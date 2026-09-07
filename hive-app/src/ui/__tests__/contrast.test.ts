import { contrastRatio } from '../contrast';
import { appChrome, derived, palette } from '../tokens';

/** Brand Kit v3.0 pairings, measured (rounded to 2 decimal places). These
 * values are the design record; a palette change that shifts them fails. */
describe('Brand Kit v3.0 pairing measurements', () => {
  const round = (n: number) => Math.round(n * 100) / 100;

  it('Soft Black on Warm Paper is 16.63:1 (primary light-theme text)', () => {
    expect(round(contrastRatio(palette.softBlack, palette.warmPaper))).toBe(16.63);
  });

  it('Warm Paper on Soft Black is 16.63:1 (primary dark-theme text)', () => {
    expect(round(contrastRatio(palette.warmPaper, palette.softBlack))).toBe(16.63);
  });

  it('Muted Copy on Warm Paper is 5.89:1 (secondary light text, field boundary)', () => {
    expect(round(contrastRatio(palette.mutedCopy, palette.warmPaper))).toBe(5.89);
  });

  it('Sage on Soft Black is 8.10:1 (secondary dark text)', () => {
    expect(round(contrastRatio(palette.sage, palette.softBlack))).toBe(8.1);
  });

  it('Soft Black on Honey Gold is 11.24:1 (dark primary action, selected destination)', () => {
    expect(round(contrastRatio(palette.softBlack, palette.honeyGold))).toBe(11.24);
  });

  it('Honey Ink on Soft Honey is 5.59:1 (attention label)', () => {
    expect(round(contrastRatio(palette.honeyInk, palette.softHoney))).toBe(5.59);
  });

  it('Honey Ink on Warm Paper is 6.91:1 (accessible accent and focus on light)', () => {
    expect(round(contrastRatio(palette.honeyInk, palette.warmPaper))).toBe(6.91);
  });

  it('Soft Black on Soft Moss is 13.09:1 (settled state on light)', () => {
    expect(round(contrastRatio(palette.softBlack, palette.softMoss))).toBe(13.09);
  });

  it('Warm Paper on Error is 5.94:1 (danger panel) and Error on Warm Paper is 5.94:1 (danger text)', () => {
    expect(round(contrastRatio(palette.warmPaper, palette.error))).toBe(5.94);
    expect(round(contrastRatio(palette.error, palette.warmPaper))).toBe(5.94);
  });

  it('Success on Warm Paper is 6.96:1', () => {
    expect(round(contrastRatio(palette.success, palette.warmPaper))).toBe(6.96);
  });

  it('Soft Honey on Soft Black is 13.45:1 (warning and focus on dark)', () => {
    expect(round(contrastRatio(palette.softHoney, palette.softBlack))).toBe(13.45);
  });

  it('chrome: Warm Paper 17.46:1 and Sage 8.50:1 on Deep Black; Soft Honey focus 14.12:1', () => {
    expect(round(contrastRatio(appChrome.text, appChrome.background))).toBe(17.46);
    expect(round(contrastRatio(appChrome.secondaryText, appChrome.background))).toBe(8.5);
    expect(round(contrastRatio(appChrome.focusRing, appChrome.background))).toBe(14.12);
    expect(round(contrastRatio(appChrome.selectedText, appChrome.selectedBackground))).toBe(11.24);
  });

  it('FORBIDDEN: Warm Paper on Honey Gold measures only 1.48:1', () => {
    // "Never light text on gold" is not stylistic — it fails every WCAG
    // text threshold. Locked here so it stays visible.
    expect(round(contrastRatio(palette.warmPaper, palette.honeyGold))).toBe(1.48);
    expect(contrastRatio(palette.warmPaper, palette.honeyGold)).toBeLessThan(3);
  });

  it('Honey Gold on Warm Paper is 1.48:1 — gold is a fill on light surfaces, never small text', () => {
    expect(round(contrastRatio(palette.honeyGold, palette.warmPaper))).toBe(1.48);
    expect(contrastRatio(palette.honeyGold, palette.warmPaper)).toBeLessThan(3);
  });

  it('Sage on Warm Paper is 2.05:1 — decorative on light, never text or a sole boundary', () => {
    expect(round(contrastRatio(palette.sage, palette.warmPaper))).toBe(2.05);
    expect(contrastRatio(palette.sage, palette.warmPaper)).toBeLessThan(3);
  });

  it('derived dark-theme shades measure as recorded', () => {
    expect(round(contrastRatio(derived.darkDangerText, palette.softBlack))).toBe(9.7);
    expect(round(contrastRatio(derived.darkSuccessText, palette.softBlack))).toBe(10.84);
    expect(round(contrastRatio(derived.lightBlockedText, derived.lightBlockedBackground))).toBe(
      6.72,
    );
    expect(round(contrastRatio(derived.darkBlockedText, derived.darkBlockedBackground))).toBe(8.55);
  });
});

describe('contrast math sanity', () => {
  it('is symmetric and bounded', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrastRatio('#FFFFFF', '#000000')).toBeCloseTo(21, 5);
    expect(contrastRatio('#808080', '#808080')).toBeCloseTo(1, 5);
  });

  it('rejects malformed colors', () => {
    expect(() => contrastRatio('#12345', '#FFFFFF')).toThrow();
  });
});
