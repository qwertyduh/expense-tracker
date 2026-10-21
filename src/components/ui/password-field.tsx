import { useState } from 'react';
import {
  Pressable,
  StyleSheet,
  TextInput,
  type StyleProp,
  type TextInputProps,
  View,
  type ViewStyle,
} from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type PasswordFieldProps = Omit<TextInputProps, 'secureTextEntry'> & {
  containerStyle?: StyleProp<ViewStyle>;
};

export function PasswordField({
  style,
  containerStyle,
  accessibilityLabel = 'Password',
  ...rest
}: PasswordFieldProps) {
  const theme = useTheme();
  const [visible, setVisible] = useState(false);

  return (
    <View
      style={[
        styles.container,
        {
          borderColor: theme.border,
          backgroundColor: theme.background,
        },
        containerStyle,
      ]}>
      <TextInput
        {...rest}
        accessibilityLabel={accessibilityLabel}
        secureTextEntry={!visible}
        style={[styles.input, { color: theme.text }, style]}
      />
      <Pressable
        onPress={() => setVisible((value) => !value)}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel={visible ? 'Hide password' : 'Show password'}
        style={styles.eye}>
        <Svg width={21} height={21} viewBox="0 0 24 24" fill="none">
          {visible ? (
            <>
              <Path
                d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12Z"
                stroke={theme.textSecondary}
                strokeWidth={1.8}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <Circle cx={12} cy={12} r={3} stroke={theme.textSecondary} strokeWidth={1.8} />
            </>
          ) : (
            <>
              <Path
                d="M17.94 17.94A10.1 10.1 0 0 1 12 20c-7 0-11-8-11-8a18.6 18.6 0 0 1 5.06-5.94M9.9 4.24A9.9 9.9 0 0 1 12 4c7 0 11 8 11 8a18.6 18.6 0 0 1-2.16 3.19M14.12 14.12a3 3 0 1 1-4.24-4.24"
                stroke={theme.textSecondary}
                strokeWidth={1.8}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <Path
                d="M1 1l22 22"
                stroke={theme.textSecondary}
                strokeWidth={1.8}
                strokeLinecap="round"
              />
            </>
          )}
        </Svg>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingRight: Spacing.two,
  },
  input: {
    flex: 1,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: 16,
  },
  eye: {
    padding: Spacing.one,
  },
});
