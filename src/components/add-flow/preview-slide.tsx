import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { SplitParticipant } from '@/components/add-flow/split-slide';

export type PreviewSlideProps = {
  totalAmount: number;
  categoryName: string | null;
  label: string;
  merchant: string | null;
  rawSmsText: string | null;
  participants: SplitParticipant[];
  canConfirm: boolean;
  onConfirm: () => void;
  /** clear() the intent + navigate back to Home. */
  onDone: () => void;
};

const SAVED_DELAY_MS = 900;

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

  const { totalAmount, categoryName, label, merchant, rawSmsText, participants, canConfirm } = props;

  return (
    <View style={styles.body}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <ThemedText type="subtitle">Preview</ThemedText>

        <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
          <Row k="Amount" v={`₹${totalAmount.toFixed(2)}`} emphasize />
          <Row k="Category" v={categoryName ?? 'Not chosen'} />
          <Row k="Label" v={label.trim() ? label.trim() : '—'} />
          {merchant != null && <Row k="Merchant" v={merchant} />}
        </View>

        <ThemedText type="smallBold" style={styles.sectionTitle}>
          Split {participants.length > 1 ? `(${participants.length} people)` : ''}
        </ThemedText>
        <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
          {participants.map((p) => (
            <Row key={p.personId} k={p.displayName} v={`₹${p.shareAmount.toFixed(2)}`} />
          ))}
        </View>

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
