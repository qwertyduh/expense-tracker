import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Fonts, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * Reported upward so Preview and the DB write know how to record the expense.
 *
 * Semantics: totalAmount is the full bill; selfShare is YOUR portion of it
 * (what the expense row stores as `amount`). Everyone else simply covers the
 * remainder — this is a local single-user app, so other people are a count,
 * not named participants.
 */
export type SplitSummary = {
  /** True when your share is less than the full bill (someone else covers the rest). */
  isSplit: boolean;
  totalAmount: number;
  /** Your portion of the bill — clamped to [0, totalAmount]. */
  selfShare: number;
  /** How many people the bill is shared across (1 = you alone). */
  participantCount: number;
};

export type SplitSlideProps = {
  totalAmount: number;
  onChange: (summary: SplitSummary) => void;
};

const QUICK_COUNTS = [1, 2, 3, 4, 5, 6, 7, 8];

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function sanitizeDecimal(raw: string): string {
  let out = raw.replace(/[^0-9.]/g, '');
  const firstDot = out.indexOf('.');
  if (firstDot !== -1) {
    out = out.slice(0, firstDot + 1) + out.slice(firstDot + 1).replace(/\./g, '');
  }
  return out;
}

export function SplitSlide({ totalAmount, onChange }: SplitSlideProps) {
  const theme = useTheme();
  const [count, setCount] = useState(1);
  // Raw "your share" text so "12." mid-edit stays representable. For count 1
  // it is always the full bill and the input is hidden.
  const [share, setShare] = useState('');

  const report = (nextCount: number, rawShare: string) => {
    const selfShare = round2(
      Math.max(0, Math.min(parseFloat(rawShare) || 0, totalAmount))
    );
    onChange({
      isSplit: nextCount > 1 && selfShare < round2(totalAmount),
      totalAmount,
      selfShare,
      participantCount: nextCount,
    });
  };

  // Default to no-split (you alone, full bill) whenever the bill amount changes.
  useEffect(() => {
    setCount(1);
    setShare(String(round2(totalAmount)));
    report(1, String(round2(totalAmount)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalAmount]);

  const evenShare = round2(totalAmount / count);
  const isSolo = count === 1;

  const selectCount = (nextCount: number) => {
    const even = String(round2(totalAmount / nextCount));
    setCount(nextCount);
    setShare(even);
    report(nextCount, even);
  };

  const editShare = (raw: string) => {
    const cleaned = sanitizeDecimal(raw);
    // Enforce the cap while typing: ignore any edit that would exceed the bill.
    const numeric = parseFloat(cleaned);
    if (cleaned !== '' && !Number.isNaN(numeric) && numeric > totalAmount) return;
    setShare(cleaned);
    report(count, cleaned);
  };

  return (
    <View style={styles.body}>
      <ThemedText type="subtitle">Who's splitting this?</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        How many of you share this bill
      </ThemedText>

      <View style={styles.countChips}>
        {QUICK_COUNTS.map((c) => {
          const active = c === count;
          return (
            <Pressable
              key={c}
              onPress={() => selectCount(c)}
              style={[
                styles.countChip,
                {
                  backgroundColor: active ? theme.backgroundSelected : theme.backgroundElement,
                },
              ]}>
              <ThemedText type="smallBold">{c}</ThemedText>
            </Pressable>
          );
        })}
      </View>

      {isSolo ? (
        <ThemedText type="small" themeColor="textSecondary">
          No split — the full {`₹${round2(totalAmount).toFixed(2)}`} is yours
        </ThemedText>
      ) : (
        <View style={styles.splitArea}>
          <View style={styles.inputRow}>
            <ThemedText type="title">₹</ThemedText>
            <TextInput
              style={[styles.input, { color: theme.text }]}
              value={share}
              onChangeText={editShare}
              placeholder="0"
              placeholderTextColor={theme.textSecondary}
              selectionColor={theme.backgroundSelected}
              keyboardType="decimal-pad"
              inputAccessoryViewButtonLabel="Done"
              accessibilityLabel="Your share of the bill"
            />
          </View>
          <ThemedText type="small" themeColor="textSecondary">
            Your share · max {`₹${round2(totalAmount).toFixed(2)}`} · even share is{' '}
            {`₹${evenShare.toFixed(2)}`}
          </ThemedText>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    alignItems: 'center',
    gap: Spacing.three,
  },
  countChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: Spacing.two,
    maxWidth: 360,
  },
  countChip: {
    minWidth: 44,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
    alignItems: 'center',
  },
  splitArea: {
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
