import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { addPerson, listPeople, PersonRow } from '@/db/people';
import { useTheme } from '@/hooks/use-theme';

// Flattened participant list reported upward so Preview can assemble the
// expense + expense_participants rows. shareAmount is the share stored in DB.
export type SplitParticipant = {
  /** 'self' for you, else the people.id. */
  personId: string;
  displayName: string;
  shareAmount: number;
};

export type SplitSummary = {
  isSplit: boolean;
  totalAmount: number;
  participants: SplitParticipant[];
};

export type SplitSlideProps = {
  totalAmount: number;
  onChange: (summary: SplitSummary) => void;
};

// Stable per-row key — 'self' for you, people.id for everyone else.
const SELF_KEY = 'self';

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

const QUICK_COUNTS = [1, 2, 3, 4, 5, 6, 7, 8];

export function SplitSlide({ totalAmount, onChange }: SplitSlideProps) {
  const theme = useTheme();
  const [people, setPeople] = useState<PersonRow[]>([]);
  // Rows: index 0 is always self, rest are chosen others, in pick order.
  const [rows, setRows] = useState<{ key: string; name: string }[]>([
    { key: SELF_KEY, name: 'You' },
  ]);
  // Per-key share overrides. Empty means "auto even share".
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [newName, setNewName] = useState('');

  useEffect(() => {
    setPeople(listPeople());
  }, []);

  // Report the default (no split, all to self) whenever the total changes.
  useEffect(() => {
    report([{ key: SELF_KEY, name: 'You' }], {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalAmount]);

  const others = people.filter((p) => !rows.some((r) => r.key === p.id));

  const isSplit = rows.length > 1;

  const report = (nextRows: { key: string; name: string }[], nextOverrides: Record<string, string>) => {
    const even = totalAmount / nextRows.length;
    onChange({
      isSplit: nextRows.length > 1,
      totalAmount,
      participants: nextRows.map((row) => ({
        personId: row.key,
        displayName: row.name,
        shareAmount: nextOverrides[row.key] != null
          ? parseFloat(nextOverrides[row.key]) || 0
          : round2(even),
      })),
    });
  };

  // Auto even shares across everyone whenever membership changes — edits made
  // for an older split layout no longer make sense once count changes.
  const recomputeEven = (nextRows: { key: string; name: string }[]) => {
    setRows(nextRows);
    setOverrides({});
    report(nextRows, {});
  };

  const setCount = (count: number) => {
    const target = Math.max(1, Math.min(count, people.length + 1));
    const used = rows.slice(0, 1);
    for (const p of people) {
      if (used.length >= target) break;
      if (!used.some((r) => r.key === p.id)) used.push({ key: p.id, name: p.display_name });
    }
    if (used.length > 1 && target === 1) {
      // Down to 1 person -> no split.
      recomputeEven([{ key: SELF_KEY, name: 'You' }]);
    } else {
      recomputeEven(used);
    }
  };

  const addOther = (person: PersonRow) => {
    recomputeEven([...rows, { key: person.id, name: person.display_name }]);
  };

  const removeOther = (key: string) => {
    const next = rows.filter((r) => r.key !== key);
    recomputeEven(next.length ? next : [{ key: SELF_KEY, name: 'You' }]);
  };

  const addNewPerson = () => {
    const name = newName.trim();
    if (!name) return;
    const created = addPerson(name);
    setNewName('');
    setPeople(listPeople());
    recomputeEven([...rows, { key: created.id, name: created.display_name }]);
  };

  const shareText = (key: string): string => {
    const overridden = overrides[key];
    if (overridden != null) return overridden;
    return totalAmount > 0 ? String(round2(totalAmount / rows.length)) : '';
  };

  const editShare = (key: string, raw: string) => {
    const cleaned = sanitizeDecimal(raw);
    const nextOverrides = { ...overrides, [key]: cleaned };
    setOverrides(nextOverrides);
    report(rows, nextOverrides);
  };

  // Render helper for the share field on a row.
  const shareField = (row: { key: string; name: string }) => (
    <View style={[styles.shareField, { backgroundColor: theme.backgroundElement }]}>
      <ThemedText type="small">₹</ThemedText>
      <TextInput
        style={[styles.shareInput, { color: theme.text }]}
        value={shareText(row.key)}
        onChangeText={(raw) => editShare(row.key, raw)}
        keyboardType="decimal-pad"
        accessibilityLabel={`Share for ${row.name}`}
      />
    </View>
  );

  return (
    <View style={styles.body}>
      <ThemedText type="subtitle">How many people split this?</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Shares split evenly across {rows.length}
      </ThemedText>

      <View style={styles.countChips}>
        {QUICK_COUNTS.map((count) => {
          const active = count === rows.length;
          return (
            <Pressable
              key={count}
              onPress={() => setCount(count)}
              style={[
                styles.countChip,
                {
                  backgroundColor: active ? theme.backgroundSelected : theme.backgroundElement,
                },
              ]}>
              <ThemedText type="smallBold">{count}</ThemedText>
            </Pressable>
          );
        })}
      </View>

      {isSplit && (
        <>
          <View style={styles.rows}>
            {rows.map((row) => (
              <View key={row.key} style={styles.row}>
                <ThemedText type="default">{row.name}</ThemedText>
                {shareField(row)}
                {row.key !== SELF_KEY && (
                  <Pressable onPress={() => removeOther(row.key)} hitSlop={8}>
                    <ThemedText type="small" themeColor="textSecondary">
                      remove
                    </ThemedText>
                  </Pressable>
                )}
              </View>
            ))}
          </View>

          {/* Pick an existing person not already included. */}
          {others.length > 0 && (
            <View style={styles.peopleChips}>
              <ThemedText type="small" themeColor="textSecondary">
                Add person:
              </ThemedText>
              {others.map((p) => (
                <Pressable
                  key={p.id}
                  onPress={() => addOther(p)}
                  style={[styles.chip, { backgroundColor: theme.backgroundElement }]}>
                  <ThemedText type="smallBold">{p.display_name}</ThemedText>
                </Pressable>
              ))}
            </View>
          )}

          {/* Add someone new inline. */}
          <View style={styles.newRow}>
            <TextInput
              style={[styles.newInput, { color: theme.text, backgroundColor: theme.backgroundElement }]}
              value={newName}
              onChangeText={setNewName}
              placeholder="New person's name"
              placeholderTextColor={theme.textSecondary}
              onSubmitEditing={addNewPerson}
            />
            <Pressable
              onPress={addNewPerson}
              disabled={!newName.trim()}
              style={[
                styles.addButton,
                {
                  backgroundColor: newName.trim()
                    ? theme.backgroundSelected
                    : theme.backgroundElement,
                },
              ]}>
              <ThemedText type="smallBold">Add</ThemedText>
            </Pressable>
          </View>
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
  },
  countChip: {
    minWidth: 40,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
    alignItems: 'center',
  },
  rows: {
    alignSelf: 'stretch',
    gap: Spacing.two,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
  },
  shareField: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.two,
  },
  shareInput: {
    fontSize: 18,
    fontWeight: 600,
    minWidth: 72,
    paddingVertical: Spacing.two,
    textAlign: 'right',
  },
  peopleChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: Spacing.two,
    maxWidth: 360,
  },
  chip: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
    borderRadius: 999,
  },
  newRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    maxWidth: 320,
    alignSelf: 'stretch',
  },
  newInput: {
    flex: 1,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
    fontSize: 16,
  },
  addButton: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
  },
});
