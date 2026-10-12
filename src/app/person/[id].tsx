import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ListRow } from '@/components/ui/list-row';
import { Screen, ScreenHeader } from '@/components/ui/screen';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { getPerson, type PersonRow } from '@/db/people';
import { listPersonOwed, type OwedItem } from '@/db/settlements';
import { useTheme } from '@/hooks/use-theme';
import { formatCurrency, formatRelative } from '@/lib/format';

// Drill-down from a person on the "Owed to you" screen: every transaction they
// carry a share of, outstanding and settled alike, newest first.
export default function PersonScreen() {
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [person, setPerson] = useState<PersonRow | null>(null);
  const [items, setItems] = useState<OwedItem[]>([]);

  const load = useCallback(() => {
    if (!id) return;
    setPerson(getPerson(id));
    setItems(listPersonOwed(id));
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const outstanding = items.reduce((sum, item) => sum + item.remaining, 0);
  const paidBack = items.reduce((sum, item) => sum + item.receivedAmount, 0);

  return (
    <Screen>
      <ScreenHeader
        title={person?.display_name ?? 'Person'}
        subtitle={
          outstanding > 0 ? `${formatCurrency(outstanding)} outstanding` : 'All settled up'
        }
        right={
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <ThemedText type="linkPrimary">Done</ThemedText>
          </Pressable>
        }
      />

      {items.length === 0 ? (
        <EmptyState
          title="No transactions"
          subtitle="This person has no split expenses with you."
        />
      ) : (
        <>
          <Card>
            <View
              style={[
                styles.summaryRow,
                { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border },
              ]}>
              <ThemedText type="small" themeColor="textSecondary">
                Still owed
              </ThemedText>
              <ThemedText type="smallBold" themeColor={outstanding > 0 ? 'text' : 'success'}>
                {formatCurrency(outstanding)}
              </ThemedText>
            </View>
            <View style={styles.summaryRow}>
              <ThemedText type="small" themeColor="textSecondary">
                Paid back
              </ThemedText>
              <ThemedText type="smallBold">{formatCurrency(paidBack)}</ThemedText>
            </View>
          </Card>

          <ThemedText type="smallBold" style={styles.sectionTitle}>
            Transactions
          </ThemedText>

          <Card style={styles.listCard}>
            {items.map((item, index) => (
              <ListRow
                key={`${item.expenseId}-${index}`}
                title={item.label ?? item.merchant ?? 'Expense'}
                subtitle={`${formatRelative(item.occurredAt)} · share ${formatCurrency(
                  item.shareAmount
                )}`}
                value={item.remaining > 0 ? formatCurrency(item.remaining) : 'Paid'}
                onPress={() => router.push(`/expense/${item.expenseId}`)}
              />
            ))}
          </Card>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
    paddingVertical: Spacing.two,
  },
  sectionTitle: {
    marginTop: Spacing.two,
  },
  listCard: {
    paddingVertical: 0,
  },
});
