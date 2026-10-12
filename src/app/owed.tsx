import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';

import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ListRow } from '@/components/ui/list-row';
import { Screen, ScreenHeader } from '@/components/ui/screen';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { listOwedByPerson, type OwedGroup } from '@/db/settlements';
import { formatCurrency, formatRelative } from '@/lib/format';

// Who owes you what. One group per person, alphabetical, each with their
// expenses newest-first; a split's unnamed remainder is pinned to the bottom.
// The toggle widens the list to include shares already paid back.
export default function OwedScreen() {
  const router = useRouter();
  const [includeSettled, setIncludeSettled] = useState(false);
  const [groups, setGroups] = useState<OwedGroup[]>([]);

  const reload = useCallback(() => {
    setGroups(listOwedByPerson(includeSettled));
  }, [includeSettled]);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload])
  );

  const total = groups.reduce((sum, group) => sum + group.totalRemaining, 0);

  return (
    <Screen>
      <ScreenHeader
        title="Owed to you"
        subtitle={total > 0 ? `${formatCurrency(total)} outstanding` : 'All settled up'}
        right={
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <ThemedText type="linkPrimary">Done</ThemedText>
          </Pressable>
        }
      />

      <Card>
        <View style={styles.toggleRow}>
          <View style={styles.toggleText}>
            <ThemedText type="smallBold">Include settled</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Show expenses that have already been fully paid back
            </ThemedText>
          </View>
          <Switch
            value={includeSettled}
            onValueChange={setIncludeSettled}
            accessibilityLabel="Include settled expenses"
          />
        </View>
      </Card>

      {groups.length === 0 ? (
        <EmptyState
          title={includeSettled ? 'Nothing to show' : 'Nothing owed'}
          subtitle={
            includeSettled
              ? 'Split an expense and whoever owes you shows up here.'
              : 'Everyone is paid up. Toggle settled expenses to see history.'
          }
        />
      ) : (
        groups.map((group) => (
          <View key={group.key} style={styles.group}>
            <Pressable
              onPress={group.unnamed ? undefined : () => router.push(`/person/${group.key}`)}
              disabled={group.unnamed}
              style={({ pressed }) => [styles.groupHeader, pressed && styles.pressed]}>
              <View style={styles.groupNameRow}>
                <ThemedText type="smallBold" numberOfLines={1} style={styles.groupName}>
                  {group.name}
                </ThemedText>
                {!group.unnamed ? (
                  <ThemedText type="small" themeColor="textSecondary">
                    ›
                  </ThemedText>
                ) : null}
              </View>
              <ThemedText
                type="smallBold"
                themeColor={group.totalRemaining > 0 ? 'text' : 'success'}>
                {group.totalRemaining > 0 ? formatCurrency(group.totalRemaining) : 'Settled'}
              </ThemedText>
            </Pressable>
            <Card style={styles.listCard}>
              {group.items.map((item, index) => (
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
          </View>
        ))
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
  },
  toggleText: {
    flexShrink: 1,
    gap: Spacing.half,
  },
  group: {
    gap: Spacing.two,
  },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
    marginTop: Spacing.one,
  },
  groupNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    flexShrink: 1,
  },
  groupName: {
    flexShrink: 1,
  },
  pressed: {
    opacity: 0.7,
  },
  listCard: {
    paddingVertical: 0,
  },
});
