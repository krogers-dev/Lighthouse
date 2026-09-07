/** Bundled typography: Manrope, five static faces, loaded locally.
 *
 * Every face ships inside the app (assets/fonts, under the SIL Open Font
 * License) and is registered at launch under the family name the token
 * roles use. Nothing is fetched at runtime and no CDN is involved.
 *
 * Loading is BOUNDED. A face that has not registered within the budget
 * does not hold the splash screen or block sign-in: text renders in the
 * system font at the same size and weight, and switches to Manrope if the
 * faces finish later. Typography can never gate authentication or data
 * handling, only decorate them.
 */
import { useFonts } from 'expo-font';
import React, { createContext, useContext, useEffect, useState } from 'react';
import type { TextStyle } from 'react-native';

import Manrope400 from '../../assets/fonts/Manrope-400.ttf';
import Manrope500 from '../../assets/fonts/Manrope-500.ttf';
import Manrope600 from '../../assets/fonts/Manrope-600.ttf';
import Manrope700 from '../../assets/fonts/Manrope-700.ttf';
import Manrope800 from '../../assets/fonts/Manrope-800.ttf';

import { FONT_FACE_WEIGHT, type FontFamilyName, type TypeRole } from './tokens';

/** Family name -> the one static file registered under it. */
export const FONT_ASSETS: Record<FontFamilyName, number> = {
  Manrope400,
  Manrope500,
  Manrope600,
  Manrope700,
  Manrope800,
};

export type FontStatus = 'loading' | 'loaded' | 'fallback';

/** How long the launch waits for the faces before proceeding on system
 * fonts. Local assets register in well under a second; the budget exists
 * so that a failure never becomes an infinite splash. */
export const FONT_LOAD_BUDGET_MS = 3000;

const FontStatusContext = createContext<FontStatus>('fallback');

export function FontProvider({
  status,
  children,
}: {
  status: FontStatus;
  children: React.ReactNode;
}): React.JSX.Element {
  return <FontStatusContext.Provider value={status}>{children}</FontStatusContext.Provider>;
}

/** Outside a provider (tests, isolated renders) the answer is the safe
 * one: system fonts. */
export function useFontStatus(): FontStatus {
  return useContext(FontStatusContext);
}

/** Registers the five faces; reports loaded, still loading, or fallback
 * once the budget has passed or loading failed. A late success still
 * flips to loaded, so a slow first launch ends in the right typeface. */
export function useHiveFonts(budgetMs: number = FONT_LOAD_BUDGET_MS): FontStatus {
  const [loaded, error] = useFonts(FONT_ASSETS);
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    if (loaded) return undefined;
    const timer = setTimeout(() => setTimedOut(true), budgetMs);
    return () => clearTimeout(timer);
  }, [loaded, budgetMs]);
  if (loaded) return 'loaded';
  if (error || timedOut) return 'fallback';
  return 'loading';
}

/** The font part of a text style for a role. With the faces loaded the
 * role names its exact family AND that family's own weight — the pairing
 * that stops iOS from choosing a heavier trait and Android from faking
 * bold. Otherwise only the weight is set, so system fonts keep the same
 * hierarchy. */
export function fontStyleFor(
  role: Pick<TypeRole, 'fontFamily' | 'fontWeight'>,
  status: FontStatus,
): Pick<TextStyle, 'fontFamily' | 'fontWeight'> {
  if (status !== 'loaded') return { fontWeight: role.fontWeight };
  return { fontFamily: role.fontFamily, fontWeight: FONT_FACE_WEIGHT[role.fontFamily] };
}
