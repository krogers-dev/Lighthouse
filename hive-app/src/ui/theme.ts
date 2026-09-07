import { useColorScheme } from 'react-native';

import { themes, type SemanticColors, type ThemeName } from './tokens';

export function useThemeName(): ThemeName {
  const scheme = useColorScheme();
  return scheme === 'dark' ? 'dark' : 'light';
}

export function useThemeColors(): SemanticColors {
  return themes[useThemeName()];
}
