import { ReactNode } from 'react';
import { ScrollView, StyleSheet, View, type ViewProps } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';

export function ScreenHeader({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
}) {
  return (
    <View style={styles.header}>
      <View style={styles.headerText}>
        <ThemedText type="subtitle">{title}</ThemedText>
        {subtitle ? (
          <ThemedText type="small" themeColor="textSecondary">
            {subtitle}
          </ThemedText>
        ) : null}
      </View>
      {right}
    </View>
  );
}

export function Screen({
  children,
  scroll = true,
  contentStyle,
  ...rest
}: ViewProps & { scroll?: boolean; contentStyle?: ViewProps['style'] }) {
  const insets = useSafeAreaInsets();
  const padding = {
    paddingTop: insets.top + Spacing.three,
    paddingBottom: BottomTabInset + Spacing.four,
  };

  if (!scroll) {
    return (
      <View style={[styles.container, padding]} {...rest}>
        <View style={[styles.inner, contentStyle]}>{children}</View>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.scrollContent, padding]}
      showsVerticalScrollIndicator={false}
      {...rest}>
      <View style={[styles.inner, contentStyle]}>{children}</View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    alignItems: 'center',
  },
  inner: {
    width: '100%',
    maxWidth: MaxContentWidth,
    paddingHorizontal: Spacing.four,
    gap: Spacing.three,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
    marginBottom: Spacing.two,
  },
  headerText: {
    gap: Spacing.half,
    flexShrink: 1,
  },
});
