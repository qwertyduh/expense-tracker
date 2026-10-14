import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type NoticeTone = 'warning' | 'info';

/**
 * A lightweight, non-blocking heads-up shown at the top of a form. It never
 * captures touches (`pointerEvents="none"`) and dismisses itself, so it is a
 * nudge rather than an `Alert` that stops the flow.
 */
export function Notice({
  message,
  tone = 'warning',
}: {
  message: string | null;
  tone?: NoticeTone;
}) {
  const theme = useTheme();
  if (!message) return null;

  const accent = tone === 'warning' ? theme.warning : theme.accent;

  return (
    <View
      accessibilityLiveRegion="polite"
      pointerEvents="none"
      style={[
        styles.notice,
        { backgroundColor: theme.backgroundElement, borderColor: accent },
      ]}>
      <View style={[styles.bar, { backgroundColor: accent }]} />
      <ThemedText type="small" themeColor={tone === 'warning' ? 'warning' : 'accent'} style={styles.text}>
        {message}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  notice: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.md,
    paddingVertical: Spacing.two,
    paddingRight: Spacing.three,
    overflow: 'hidden',
  },
  bar: {
    width: 3,
    alignSelf: 'stretch',
    borderRadius: Radius.pill,
  },
  text: {
    flex: 1,
  },
});
