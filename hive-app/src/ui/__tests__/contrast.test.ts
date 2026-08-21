import { contrastRatio } from '../contrast';
import { palette } from '../tokens';

/** Brand Kit v2.0 pairings, measured (rounded to 2 decimal places). These
 * values are the design record; a palette change that shifts them fails. */
describe('Brand Kit v2.0 pairing measurements', () => {
  const round = (n: number) => Math.round(n * 100) / 100;

  it('Soft Black on Wax White is 15.80:1 (primary light-theme text)', () => {
    expect(round(contrastRatio(palette.softBlack, palette.waxWhite))).toBe(15.8);
  });

  it('Soft Black on Clean White is 19.72:1 (text on cards)', () => {
    expect(round(contrastRatio(palette.softBlack, palette.cleanWhite))).toBe(19.72);
  });

  it('Soft Black on Honey Gold is 9.56:1 (gold control text)', () => {
    expect(round(contrastRatio(palette.softBlack, palette.honeyGold))).toBe(9.56);
  });

  it('Soft Black on Warm Amber is 11.43:1 (attention panels)', () => {
    expect(round(contrastRatio(palette.softBlack, palette.warmAmber))).toBe(11.43);
  });

  it('Honey Gold on Soft Black is 9.56:1 (accent text on dark)', () => {
    expect(round(contrastRatio(palette.honeyGold, palette.softBlack))).toBe(9.56);
  });

  it('FORBIDDEN: white text on Honey Gold measures only 2.06:1', () => {
    // The rule "do not use white text on Honey Gold" is not stylistic —
    // it fails every WCAG text threshold. Locked here so it stays visible.
    expect(round(contrastRatio(palette.cleanWhite, palette.honeyGold))).toBe(2.06);
    expect(contrastRatio(palette.cleanWhite, palette.honeyGold)).toBeLessThan(3);
  });

  it('Honey Gold on Wax White is 1.65:1 — gold is non-text on light surfaces', () => {
    expect(round(contrastRatio(palette.honeyGold, palette.waxWhite))).toBe(1.65);
    expect(contrastRatio(palette.honeyGold, palette.waxWhite)).toBeLessThan(3);
  });

  it('Muted Stone on Wax White is 4.28:1 — disabled/quiet use only', () => {
    expect(round(contrastRatio(palette.mutedStone, palette.waxWhite))).toBe(4.28);
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
