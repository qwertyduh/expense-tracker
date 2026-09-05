import { KeyboardAvoidingView, Platform, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type LabelSlideProps = {
  value: string;
  onChangeLabel: (next: string) => void;
};

// Optional free-text note. Skippable — no validation, Next works with empty value.
export function LabelSlide({ value, onChangeLabel }: LabelSlideProps) {
  const theme = useTheme();

  return (
    <KeyboardAvoidingView
      style={styles.wrapper}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.body}>
        <ThemedText type="subtitle">Give it a label</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Optional — e.g. "Zomato - team lunch"
        </ThemedText>

        <TextInput
          style={[
            styles.input,
            { color: theme.text, backgroundColor: theme.backgroundElement },
          ]}
          value={value}
          onChangeText={onChangeLabel}
          placeholder="Label"
          placeholderTextColor={theme.textSecondary}
          autoCapitalize="sentences"
          autoFocus
          accessibilityLabel="Label"
        />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    flex: 1,
    justifyContent: 'center',
  },
  body: {
    alignItems: 'center',
    gap: Spacing.two,
  },
  input: {
    alignSelf: 'stretch',
    fontSize: 18,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    borderRadius: Spacing.two,
  },
});
