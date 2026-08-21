import React from 'react';
import { Text, type TextProps, type TextStyle } from 'react-native';

import { useThemeColors } from '../theme';
import { typeScale, type TypeVariant } from '../tokens';

export interface AppTextProps extends Omit<TextProps, 'style'> {
  variant?: TypeVariant;
  tone?: 'primary' | 'secondary' | 'danger' | 'success' | 'warning' | 'disabled' | 'inverse';
  align?: TextStyle['textAlign'];
  style?: TextStyle;
  children: React.ReactNode;
}

/** Themed text. Font scaling is never capped below the WCAG 200% requirement;
 * layout must absorb growth instead of truncating meaning. */
export function AppText({
  variant = 'body',
  tone = 'primary',
  align,
  style,
  children,
  ...rest
}: AppTextProps): React.JSX.Element {
  const colors = useThemeColors();
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
          fontWeight: base.fontWeight as TextStyle['fontWeight'],
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
