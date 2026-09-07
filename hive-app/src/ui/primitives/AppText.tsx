import React from 'react';
import { Text, type TextProps, type TextStyle } from 'react-native';

import { fontStyleFor, useFontStatus } from '../fonts';
import { useThemeColors } from '../theme';
import { typeScale, type TypeVariant } from '../tokens';

export interface AppTextProps extends Omit<TextProps, 'style'> {
  variant?: TypeVariant;
  tone?: 'primary' | 'secondary' | 'danger' | 'success' | 'warning' | 'disabled' | 'inverse';
  align?: TextStyle['textAlign'];
  style?: TextStyle;
  children: React.ReactNode;
}

/** Themed text in the role's exact Manrope face (system font of the same
 * weight until the faces are registered). Font scaling is never capped
 * below the WCAG 200% requirement; layout must absorb growth instead of
 * truncating meaning. */
export function AppText({
  variant = 'body',
  tone = 'primary',
  align,
  style,
  children,
  ...rest
}: AppTextProps): React.JSX.Element {
  const colors = useThemeColors();
  const fontStatus = useFontStatus();
  const toneColor: Record<NonNullable<AppTextProps['tone']>, string> = {
    primary: colors.textPrimary,
    secondary: colors.textSecondary,
    danger: colors.dangerText,
    success: colors.successText,
    warning: colors.warningText,
    disabled: colors.textDisabled,
    inverse: colors.primaryActionText,
  };
  const base = typeScale[variant];
  return (
    <Text
      allowFontScaling
      {...rest}
      style={[
        {
          fontSize: base.fontSize,
          lineHeight: base.lineHeight,
          ...fontStyleFor(base, fontStatus),
          color: toneColor[tone],
          textAlign: align,
        },
        style,
      ]}
    >
      {children}
    </Text>
  );
}
