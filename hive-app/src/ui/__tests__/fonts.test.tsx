import { act, render, renderHook, screen } from '@testing-library/react-native';
import { useFonts } from 'expo-font';

import {
  FONT_ASSETS,
  FONT_LOAD_BUDGET_MS,
  FontProvider,
  fontStyleFor,
  useHiveFonts,
} from '../fonts';
import { AppText } from '../primitives/AppText';
import { TextField } from '../primitives/TextField';
import { inputType, typeScale } from '../tokens';

jest.mock('expo-font', () => ({ useFonts: jest.fn() }));
const mockedUseFonts = jest.mocked(useFonts);

function flatten(style: unknown): Record<string, unknown> {
  if (Array.isArray(style)) return Object.assign({}, ...style.flat(Infinity).filter(Boolean));
  return (style ?? {}) as Record<string, unknown>;
}

describe('fontStyleFor', () => {
  it('names the exact face and its own weight once the faces are loaded', () => {
    expect(fontStyleFor(typeScale.heading, 'loaded')).toEqual({
      fontFamily: 'Manrope700',
      fontWeight: '700',
    });
    expect(fontStyleFor(inputType, 'loaded')).toEqual({
      fontFamily: 'Manrope500',
      fontWeight: '500',
    });
  });

  it('keeps only the weight before the faces are loaded, so system fonts hold the hierarchy', () => {
    expect(fontStyleFor(typeScale.heading, 'loading')).toEqual({ fontWeight: '700' });
    expect(fontStyleFor(typeScale.body, 'fallback')).toEqual({ fontWeight: '400' });
  });
});

describe('useHiveFonts', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('asks expo-font for exactly the five bundled faces', async () => {
    mockedUseFonts.mockReturnValue([true, null]);
    await renderHook(() => useHiveFonts());
    expect(mockedUseFonts).toHaveBeenCalledWith(FONT_ASSETS);
    expect(Object.keys(FONT_ASSETS).sort()).toEqual([
      'Manrope400',
      'Manrope500',
      'Manrope600',
      'Manrope700',
      'Manrope800',
    ]);
  });

  it('reports loaded as soon as the faces register', async () => {
    mockedUseFonts.mockReturnValue([true, null]);
    const { result } = await renderHook(() => useHiveFonts());
    expect(result.current).toBe('loaded');
  });

  it('is bounded: past the budget it proceeds on system fonts instead of waiting', async () => {
    mockedUseFonts.mockReturnValue([false, null]);
    const { result } = await renderHook(() => useHiveFonts());
    expect(result.current).toBe('loading');
    await act(async () => {
      jest.advanceTimersByTime(FONT_LOAD_BUDGET_MS - 1);
    });
    expect(result.current).toBe('loading');
    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(result.current).toBe('fallback');
  });

  it('treats a loading error as the fallback, never as a blocked launch', async () => {
    mockedUseFonts.mockReturnValue([false, new Error('font failed')]);
    const { result } = await renderHook(() => useHiveFonts());
    expect(result.current).toBe('fallback');
  });

  it('still switches to the faces if they arrive after the budget', async () => {
    mockedUseFonts.mockReturnValue([false, null]);
    const { result, rerender } = await renderHook(() => useHiveFonts());
    await act(async () => {
      jest.advanceTimersByTime(FONT_LOAD_BUDGET_MS);
    });
    expect(result.current).toBe('fallback');
    mockedUseFonts.mockReturnValue([true, null]);
    await rerender(undefined);
    expect(result.current).toBe('loaded');
  });
});

describe('the primitives consume the bundled faces explicitly', () => {
  it('AppText renders the role’s Manrope face with its own weight when loaded', async () => {
    await render(
      <FontProvider status="loaded">
        <AppText variant="title" testID="t">
          Home
        </AppText>
      </FontProvider>,
    );
    const style = flatten(screen.getByTestId('t').props.style);
    expect(style.fontFamily).toBe('Manrope700');
    expect(style.fontWeight).toBe('700');
    expect(style.fontSize).toBe(32);
    expect(style.lineHeight).toBe(38);
  });

  it('AppText renders system fonts at the same weight outside a loaded provider', async () => {
    await render(
      <AppText variant="title" testID="t">
        Home
      </AppText>,
    );
    const style = flatten(screen.getByTestId('t').props.style);
    expect(style.fontFamily).toBeUndefined();
    expect(style.fontWeight).toBe('700');
  });

  it('the native TextInput gets Manrope Medium itself, not only its label', async () => {
    await render(
      <FontProvider status="loaded">
        <TextField label="Email" value="" onChangeText={() => undefined} testID="email" />
      </FontProvider>,
    );
    const input = flatten(screen.getByTestId('email').props.style);
    expect(input.fontFamily).toBe('Manrope500');
    expect(input.fontWeight).toBe('500');
    expect(input.fontSize).toBe(16);
    expect(input.borderRadius).toBe(0);
    expect(Number(input.minHeight)).toBeGreaterThanOrEqual(48);
  });
});
