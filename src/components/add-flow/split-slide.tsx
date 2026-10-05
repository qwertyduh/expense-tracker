import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Fonts, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { resplitEvenly } from '@/lib/matching';

export type SplitParticipant = { name: string; shareAmount: number };

/**
 * Reported upward so Preview and the DB write know how to record the expense.
 *
 * Semantics: totalAmount is the full bill; selfShare is YOUR portion of it
 * (what the expense row stores as `amount`). The remainder is split EVENLY
 * across the other named participants, each of whom owes their share back.
 */
export type SplitSummary = {
  /** True when your share is less than the full bill (someone else covers the rest). */
  isSplit: boolean;
  totalAmount: number;
  /** Your portion of the bill — clamped to [0, totalAmount]. */
  selfShare: number;
  /** How many people the bill is shared across (1 = you alone). */
  participantCount: number;
  /** Named others and the amount each owes; empty when there is no split. */
  participants: SplitParticipant[];
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

// Keep a names array exactly `size` long, preserving what was already typed.
function resizeNames(names: string[], size: number): string[] {
  if (size <= 0) return [];
  const next = names.slice(0, size);
  while (next.length < size) next.push('');
  return next;
}

export function SplitSlide({ totalAmount, onChange }: SplitSlideProps) {
  const theme = useTheme();
  const [count, setCount] = useState(1);
  // Raw "your share" text so "12." mid-edit stays representable. For count 1
  // it is always the full bill and the input is hidden.
  const [share, setShare] = useState('');
  // One name per OTHER participant (length count - 1).
  const [names, setNames] = useState<string[]>([]);

  const report = (nextCount: number, rawShare: string, nextNames: string[]) => {
    const selfShare = round2(
      Math.max(0, Math.min(parseFloat(rawShare) || 0, totalAmount))
    );
    // Others' shares are split evenly from whatever is left after your share.
    const othersTotal = round2(totalAmount - selfShare);
    const participants: SplitParticipant[] =
      nextCount > 1 && othersTotal > 0
        ? resplitEvenly(othersTotal, nextCount - 1).map((shareAmount, i) => ({
            // Blank names still produce a usable row for Preview + the DB write.
            name: nextNames[i]?.trim() || `Person ${i + 2}`,
            shareAmount,
          }))
        : [];
    onChange({
      isSplit: nextCount > 1 && selfShare < round2(totalAmount),
      totalAmount,
      selfShare,
      participantCount: nextCount,
      participants,
    });
  };

  // Default to no-split (you alone, full bill) whenever the bill amount changes.
  useEffect(() => {
    setCount(1);
    setShare(String(round2(totalAmount)));
    setNames([]);
    report(1, String(round2(totalAmount)), []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalAmount]);

  const evenShare = round2(totalAmount / count);
  const isSolo = count === 1;

  // Live values used to render the per-participant hints without waiting for
  // a parent re-render of the reported summary.
  const selfShare = round2(Math.max(0, Math.min(parseFloat(share) || 0, totalAmount)));
  const othersTotal = round2(totalAmount - selfShare);
  const otherShares =
    count > 1 && othersTotal > 0 ? resplitEvenly(othersTotal, count - 1) : [];

  const selectCount = (nextCount: number) => {
    const even = String(round2(totalAmount / nextCount));
    const nextNames = resizeNames(names, nextCount - 1);
    setCount(nextCount);
    setShare(even);
    setNames(nextNames);
    report(nextCount, even, nextNames);
  };

  const editShare = (raw: string) => {
    const cleaned = sanitizeDecimal(raw);
    // Enforce the cap while typing: ignore any edit that would exceed the bill.
    const numeric = parseFloat(cleaned);
    if (cleaned !== '' && !Number.isNaN(numeric) && numeric > totalAmount) return;
    setShare(cleaned);
    report(count, cleaned, names);
  };

  const editName = (index: number, value: string) => {
    const nextNames = names.map((name, i) => (i === index ? value : name));
    setNames(nextNames);
    report(count, share, nextNames);
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
        <>
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

          {otherShares.length > 0 && (
            <View style={styles.participants}>
              <ThemedText type="small" themeColor="textSecondary">
                Who&apos;s covering the rest? Name each person
              </ThemedText>
              {names.map((name, index) => (
                <View key={index} style={styles.participantRow}>
                  <TextInput
                    style={[
                      styles.nameInput,
                      {
                        color: theme.text,
                        borderColor: theme.border,
                        backgroundColor: theme.backgroundElement,
                      },
                    ]}
                    value={name}
                    onChangeText={(value) => editName(index, value)}
                    placeholder="Who are they? / name"
                    placeholderTextColor={theme.textSecondary}
                    selectionColor={theme.backgroundSelected}
                    accessibilityLabel={`Name of participant ${index + 2}`}
                  />
                  <ThemedText type="small" themeColor="textSecondary">
                    Even share {`₹${otherShares[index].toFixed(2)}`}
                  </ThemedText>
                </View>
              ))}
            </View>
          )}
        </>
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
  participants: {
    alignSelf: 'stretch',
    maxWidth: 360,
    width: '100%',
    gap: Spacing.two,
  },
  participantRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  nameInput: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 16,
    fontFamily: Fonts.sans,
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
