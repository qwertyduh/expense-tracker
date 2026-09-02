import { StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Fonts, Spacing, ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type AmountSlideProps = {
  /** Current amount as a raw input string (kept as string so typing "12." mid-edit works). */
  value: string;
  onChangeAmount: (next: string) => void;
  /** Focus the keyboard immediately on mount (manual entry). */
  autoFocus: boolean;
};

// Keeps only digits and a single decimal point; total_amount before split math.
function sanitizeAmount(raw: string): string {
  let out = raw.replace(/[^0-9.]/g, '');
  const firstDot = out.indexOf('.');
  if (firstDot !== -1) {
    out = out.slice(0, firstDot + 1) + out.slice(firstDot + 1).replace(/\./g, '');
  }
  return out;
}

export function AmountSlide({ value, onChangeAmount, autoFocus }: AmountSlideProps) {
  const theme = useTheme();
  const placeholderColor: ThemeColor = 'textSecondary';

  return (
    <View style={styles.body}>
      <ThemedText type="subtitle">How much?</ThemedText>
      <ThemedText type="small" themeColor={placeholderColor}>
        Amount before any split
      </ThemedText>

      <View style={styles.inputRow}>
        <ThemedText type="title">₹</ThemedText>
        <TextInput
          style={[styles.input, { color: theme.text }]}
          value={value}
          onChangeText={(raw) => onChangeAmount(sanitizeAmount(raw))}
          placeholder="0"
          placeholderTextColor={theme.textSecondary}
          selectionColor={theme.backgroundSelected}
          keyboardType="decimal-pad"
          autoFocus={autoFocus}
          accessibilityLabel="Amount"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    alignItems: 'center',
    gap: Spacing.two,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: Spacing.two,
  },
  input: {
    fontSize: 48,
    lineHeight: 52,
    fontWeight: 600,
    fontFamily: Fonts.sans,
    minWidth: 120,
    textAlign: 'left',
  },
});
