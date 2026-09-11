import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet } from 'react-native';

import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ListRow } from '@/components/ui/list-row';
import { Screen, ScreenHeader } from '@/components/ui/screen';
import { Spacing } from '@/constants/theme';
import { listActivity, type ActivityRow } from '@/db/activity';
import { formatCurrency, formatRelative } from '@/lib/format';

const ACTION_LABEL: Record<ActivityRow['action'], string> = {
  created: 'Added',
  edited: 'Edited',
  deleted: 'Deleted',
};

export default function HistoryScreen() {
  const [events, setEvents] = useState<ActivityRow[]>([]);

  useFocusEffect(
    useCallback(() => {
      setEvents(listActivity(200));
    }, [])
  );

  return (
    <Screen>
      <ScreenHeader title="History" subtitle="Every add, edit and delete" />

      {events.length === 0 ? (
        <EmptyState title="Nothing yet" subtitle="Activity will appear here as you add expenses." />
      ) : (
        <Card style={styles.listCard}>
          {events.map((event) => {
            let amount: number | null = null;
            let title = 'Expense';
            try {
              const snapshot = JSON.parse(event.expense_snapshot);
              amount = typeof snapshot.amount === 'number' ? snapshot.amount : null;
              title = snapshot.merchant ?? snapshot.label ?? 'Expense';
            } catch {
              // snapshot missing/empty (e.g. some deletes) — keep defaults
            }
            return (
              <ListRow
                key={event.id}
                title={`${ACTION_LABEL[event.action]} · ${title}`}
                subtitle={formatRelative(event.occurred_at)}
                value={amount != null ? formatCurrency(amount) : undefined}
              />
            );
          })}
        </Card>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  listCard: {
    paddingVertical: 0,
  },
});
