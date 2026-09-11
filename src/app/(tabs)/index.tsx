import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Dimensions, StyleSheet, View } from 'react-native';
import { PieChart } from 'react-native-chart-kit';

import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Fab } from '@/components/ui/fab';
import { ListRow } from '@/components/ui/list-row';
import { Screen, ScreenHeader } from '@/components/ui/screen';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { listExpenses, type ExpenseRow } from '@/db/expenses';
import { useAddExpenseIntentContext } from '@/hooks/add-expense-intent-provider';
import { useTheme } from '@/hooks/use-theme';
import { formatCurrency, formatRelative, monthKey, monthLabel } from '@/lib/format';

const CHART_COLORS = [
  '#3C87F7',
  '#F2994A',
  '#27AE60',
  '#9B51E0',
  '#EB5757',
  '#2D9CDB',
  '#F2C94C',
  '#BB6BD9',
];

export default function HomeScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { startManual } = useAddExpenseIntentContext();
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);

  const reload = useCallback(() => {
    setExpenses(listExpenses(200));
  }, []);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload])
  );

  const { monthTotal, byCategory } = useMemo(() => {
    const current = monthKey(new Date().toISOString());
    const monthExpenses = expenses.filter((e) => monthKey(e.occurred_at) === current);
    const total = monthExpenses.reduce((sum, e) => sum + e.amount, 0);
    const grouped = new Map<string, number>();
    for (const e of monthExpenses) {
      const name = e.category_name ?? 'Uncategorized';
      grouped.set(name, (grouped.get(name) ?? 0) + e.amount);
    }
    const slices = [...grouped.entries()]
      .map(([name, amount], i) => ({
        name,
        amount,
        color: CHART_COLORS[i % CHART_COLORS.length],
        legendFontColor: theme.text,
        legendFontSize: 12,
      }))
      .sort((a, b) => b.amount - a.amount);
    return { monthTotal: total, byCategory: slices };
  }, [expenses, theme.text]);

  const chartWidth = Math.min(Dimensions.get('window').width, 800) - Spacing.four * 2 - Spacing.three * 2;

  return (
    <Screen>
      <ScreenHeader
        title="Expenses"
        subtitle={`${monthLabel(monthKey(new Date().toISOString()))} · your share`}
      />

      <Card>
        <ThemedText type="small" themeColor="textSecondary">
          Spent this month
        </ThemedText>
        <ThemedText type="title" style={styles.total}>
          {formatCurrency(monthTotal)}
        </ThemedText>
      </Card>

      {byCategory.length > 0 ? (
        <Card style={styles.chartCard}>
          <ThemedText type="smallBold">By category</ThemedText>
          <PieChart
            data={byCategory}
            width={chartWidth}
            height={180}
            accessor="amount"
            backgroundColor="transparent"
            paddingLeft="0"
            chartConfig={{
              color: () => theme.text,
            }}
          />
        </Card>
      ) : null}

      <ThemedText type="smallBold" style={styles.sectionTitle}>
        Recent
      </ThemedText>

      {expenses.length === 0 ? (
        <EmptyState
          title="No expenses yet"
          subtitle="Tap + to add one, or pay with GPay and it will show up here automatically."
        />
      ) : (
        <Card style={styles.listCard}>
          {expenses.slice(0, 12).map((expense) => (
            <ListRow
              key={expense.id}
              title={expense.merchant ?? expense.label ?? expense.category_name ?? 'Expense'}
              subtitle={`${expense.category_name ?? 'Uncategorized'} · ${formatRelative(expense.occurred_at)}`}
              value={formatCurrency(expense.amount)}
              onPress={() => router.push(`/expense/${expense.id}`)}
            />
          ))}
        </Card>
      )}

      <View style={styles.fabSpacer} />
      <Fab label="+ Add" onPress={startManual} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  total: {
    marginTop: Spacing.one,
  },
  chartCard: {
    alignItems: 'center',
  },
  sectionTitle: {
    marginTop: Spacing.two,
  },
  listCard: {
    paddingVertical: 0,
  },
  fabSpacer: {
    height: Spacing.six,
  },
});
