import { contrastRatio } from '../contrast';
import { palette } from '../tokens';

/** The approved brand pairings, measured. Values must match the design
 * brief's published table (rounded to 2 decimal places). */
describe('approved brand pairing measurements', () => {
  const round = (n: number) => Math.round(n * 100) / 100;

  it('Graphite on Eggshell is 16.32:1', () => {
    expect(round(contrastRatio(palette.graphite, palette.eggshell))).toBe(16.32);
  });

  it('Graphite on Mineral Slate is 10.37:1', () => {
    expect(round(contrastRatio(palette.graphite, palette.slate))).toBe(10.37);
  });

  it('Graphite on Soft Moss is 12.33:1', () => {
    expect(round(contrastRatio(palette.graphite, palette.moss))).toBe(12.33);
  });

  it('Rose on Eggshell is 4.24:1 (non-text or qualifying large text only)', () => {
    expect(round(contrastRatio(palette.rose, palette.eggshell))).toBe(4.24);
  });

  it('Rose on Graphite is 3.85:1 (non-text or qualifying large text only)', () => {
    expect(round(contrastRatio(palette.rose, palette.graphite))).toBe(3.85);
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
