import { fireEvent, render, screen } from '@testing-library/react-native';

import {
  BrandHeader,
  HIVE_MARK_ASPECT,
  HIVE_MARK_WIDTH,
  markHeightFor,
} from '../primitives/BrandHeader';

describe('BrandHeader', () => {
  it('renders the approved mark at its natural aspect ratio beside the wordmark', async () => {
    await render(<BrandHeader />);
    const mark = screen.getByTestId('brand-mark', { includeHiddenElements: true });
    // 512 × 460: never stretched, never a different shape.
    expect(HIVE_MARK_ASPECT).toBeCloseTo(512 / 460, 6);
    expect(markHeightFor(512)).toBe(460);
    const style = Object.assign({}, ...[mark.props.style].flat(Infinity).filter(Boolean)) as {
      width: number;
      height: number;
    };
    expect(style.width).toBe(HIVE_MARK_WIDTH);
    expect(style.height).toBe(markHeightFor(HIVE_MARK_WIDTH));
    expect(mark.props.resizeMode).toBe('contain');
    expect(screen.getByText('HIVE')).toBeTruthy();
    expect(screen.getByText('by Honeybee Accounting')).toBeTruthy();
  });

  it('keeps the image out of the accessibility tree: the words are the lockup', async () => {
    await render(<BrandHeader />);
    const mark = screen.getByTestId('brand-mark', { includeHiddenElements: true });
    expect(mark.props.accessible).toBe(false);
    expect(mark.props.importantForAccessibility).toBe('no');
    expect(mark.props.accessibilityElementsHidden).toBe(true);
  });

  it('falls back to the text lockup, and nothing else, when the image fails to load', async () => {
    await render(<BrandHeader />);
    await fireEvent(screen.getByTestId('brand-mark', { includeHiddenElements: true }), 'error', {
      nativeEvent: { error: 'decode' },
    });
    expect(screen.queryByTestId('brand-mark', { includeHiddenElements: true })).toBeNull();
    expect(screen.getByText('HIVE')).toBeTruthy();
    expect(screen.getByText('by Honeybee Accounting')).toBeTruthy();
  });
});
