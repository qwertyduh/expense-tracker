import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { SplitSummary } from '@/components/add-flow/split-slide';

export type PreviewSlideProps = {
  totalAmount: number;
  categoryName: string | null;
  label: string;
  merchant: string | null;
  rawSmsText: string | null;
  /** null = split step never produced a value yet (can't have reached preview). */
  split: SplitSummary | null;
  canConfirm: boolean;
  onConfirm: () => void;
  /** clear() the intent + navigate back to Home. */
  onDone: () => void;
};

const SAVED_DELAY_MS = 900;

function fmt(n: number): string {
  return `₹${(Math.round(n * 100) / 100).toFixed(2)}`;
}

function Row({ k, v, emphasize }: { k: string; v: string; emphasize?: boolean }) {
  return (
    <View style={styles.row}>
      <ThemedText type="small" themeColor="textSecondary">
        {k}
      </ThemedText>
      <ThemedText type={emphasize ? 'smallBold' : 'default'} style={styles.rowValue}>
        {v}
      </ThemedText>
    </View>
  );
}

export function PreviewSlide(props: PreviewSlideProps) {
  const theme = useTheme();
  const [saved, setSaved] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const confirm = () => {
    if (!props.canConfirm || saved) return;
    props.onConfirm(); // writes happen here, inside the DB transaction
    // Explicit success state — no silent write. Show "Saved ✓", then exit.
    setSaved(true);
    timer.current = setTimeout(props.onDone, SAVED_DELAY_MS);
  };

  if (saved) {
    return (
      <View style={styles.saved}>
        <ThemedText type="title">Saved ✓</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Added to your expenses
        </ThemedText>
      </View>
    );
  }

  const { totalAmount, categoryName, label, merchant, rawSmsText, split, canConfirm } = props;

  return (
    <View style={styles.body}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <ThemedText type="subtitle">Preview</ThemedText>

        <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
          <Row k="Bill" v={fmt(totalAmount)} emphasize />
          {split?.isSplit && <Row k="Your share" v={fmt(split.selfShare)} />}
          <Row k="Category" v={categoryName ?? 'Not chosen'} />
          <Row k="Label" v={label.trim() ? label.trim() : '—'} />
          {merchant != null && <Row k="Merchant" v={merchant} />}
        </View>

        {split?.isSplit && (
          <>
            <ThemedText type="smallBold" style={styles.sectionTitle}>
              Split ({split.participantCount} people)
            </ThemedText>
            <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
              <Row k="You" v={fmt(split.selfShare)} emphasize />
              <Row k={`Others (${split.participantCount - 1})`} v={fmt(totalAmount - split.selfShare)} />
            </View>
          </>
        )}

        {rawSmsText != null && (
          <>
            <ThemedText type="smallBold" style={styles.sectionTitle}>
              From SMS
            </ThemedText>
            <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
              <ThemedText type="small">{rawSmsText}</ThemedText>
            </View>
          </>
        )}
      </ScrollView>

      <Pressable
        onPress={confirm}
        disabled={!canConfirm}
        style={[
          styles.confirmButton,
          { backgroundColor: canConfirm ? theme.backgroundSelected : theme.backgroundElement },
        ]}>
        <ThemedText type="smallBold" themeColor={canConfirm ? 'text' : 'textSecondary'}>
          Confirm & Save
        </ThemedText>
      </Pressable>
      {!canConfirm && (
        <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
          Enter an amount and pick a category to save
        </ThemedText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    gap: Spacing.three,
  },
  scroll: {
    paddingBottom: Spacing.three,
  },
  card: {
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Spacing.two,
    gap: Spacing.four,
  },
  rowValue: {
    flexShrink: 1,
  },
  sectionTitle: {
    marginTop: Spacing.two,
  },
  confirmButton: {
    alignItems: 'center',
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
  },
  hint: {
    textAlign: 'center',
  },
  saved: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
  },
});
