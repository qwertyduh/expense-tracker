import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Dimensions, Pressable, StyleSheet, View } from 'react-native';
import { PieChart } from 'react-native-chart-kit';

import { Card } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import { EmptyState } from '@/components/ui/empty-state';
import { DropletMenu } from '@/components/ui/droplet-menu';
import { ListRow } from '@/components/ui/list-row';
import { Screen, ScreenHeader } from '@/components/ui/screen';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { listExpenses, type ExpenseRow } from '@/db/expenses';
import { countPendingIncomingReceipts } from '@/db/incoming-receipts';
import { receivedTotalSince, totalOutstanding } from '@/db/settlements';
import { useAddExpenseIntentContext } from '@/hooks/add-expense-intent-provider';
import { useTheme } from '@/hooks/use-theme';
import { useExpensesChanged } from '@/lib/expenses-changed';
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

type ExpenseRange = 'thisMonth' | 'lastMonth';

const RANGE_LABEL: Record<ExpenseRange, string> = {
  thisMonth: 'This month',
  lastMonth: 'Last month',
};

export default function HomeScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { startManual } = useAddExpenseIntentContext();
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [range, setRange] = useState<ExpenseRange>('thisMonth');
  const [receivedThisMonth, setReceivedThisMonth] = useState(0);
  const [outstanding, setOutstanding] = useState(0);
  const [pendingReceipts, setPendingReceipts] = useState(0);

  const reload = useCallback(() => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    // Two months is all the range switcher needs, so bound the query instead of
    // pulling the whole table.
    setExpenses(listExpenses({ from: lastMonthStart.toISOString(), limit: 500 }));
    setReceivedThisMonth(receivedTotalSince(monthStart.toISOString()));
    setOutstanding(totalOutstanding());
    setPendingReceipts(countPendingIncomingReceipts());
  }, []);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload])
  );

  // Refresh in place when a capture is auto-logged on foreground (an ignored capsule
  // never changes navigation focus, so useFocusEffect alone won't re-run).
  useExpensesChanged(reload);

  const stats = useMemo(() => {
    const now = new Date();
    const thisKey = monthKey(now.toISOString());
    const lastKey = monthKey(new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString());

    const thisMonthExpenses = expenses.filter((e) => monthKey(e.occurred_at) === thisKey);
    const lastMonthExpenses = expenses.filter((e) => monthKey(e.occurred_at) === lastKey);
    const sum = (rows: ExpenseRow[]) => rows.reduce((total, e) => total + e.amount, 0);

    const thisTotal = sum(thisMonthExpenses);
    const lastTotal = sum(lastMonthExpenses);

    // Normalise both periods to a per-day average so a partial month and a full
    // month can be compared fairly.
    const daysElapsedThisMonth = now.getDate();
    const daysInLastMonth = new Date(now.getFullYear(), now.getMonth(), 0).getDate();
    const thisAvgPerDay = thisTotal / Math.max(1, daysElapsedThisMonth);
    const lastAvgPerDay = lastTotal / Math.max(1, daysInLastMonth);

    const selected = range === 'thisMonth' ? thisMonthExpenses : lastMonthExpenses;

    const grouped = new Map<string, number>();
    for (const e of selected) {
      const name = e.category_name ?? 'Uncategorized';
      grouped.set(name, (grouped.get(name) ?? 0) + e.amount);
    }
    const byCategory = [...grouped.entries()]
      .map(([name, amount], i) => ({
        name,
        amount,
        color: CHART_COLORS[i % CHART_COLORS.length],
        legendFontColor: theme.text,
        legendFontSize: 12,
      }))
      .sort((a, b) => b.amount - a.amount);

    return {
      selected,
      selectedTotal: range === 'thisMonth' ? thisTotal : lastTotal,
      thisAvgPerDay,
      lastAvgPerDay,
      byCategory,
      selectedMonthLabel: monthLabel(range === 'thisMonth' ? thisKey : lastKey),
    };
  }, [expenses, theme.text, range]);

  const chartWidth = Math.min(Dimensions.get('window').width, 800) - Spacing.four * 2 - Spacing.three * 2;
  const avgMax = Math.max(stats.thisAvgPerDay, stats.lastAvgPerDay);
  const selectedCount = stats.selected.length;

  return (
    <View style={styles.container}>
      <Screen>
        <ScreenHeader title="Expenses" subtitle={`${stats.selectedMonthLabel} · your share`} />

        <View style={styles.filters}>
          {(['thisMonth', 'lastMonth'] as const).map((id) => (
            <Chip
              key={id}
              label={RANGE_LABEL[id]}
              selected={id === range}
              onPress={() => setRange(id)}
            />
          ))}
        </View>

        <Card>
          <ThemedText type="small" themeColor="textSecondary">
            {range === 'thisMonth' ? 'Spent this month' : 'Spent last month'}
          </ThemedText>
          <ThemedText type="title" style={styles.total}>
            {formatCurrency(stats.selectedTotal)}
          </ThemedText>
          <View style={[styles.summaryRow, { borderTopColor: theme.border }]}>
            <ThemedText type="small" themeColor="textSecondary">
              Received back this month
            </ThemedText>
            <ThemedText type="smallBold">{formatCurrency(receivedThisMonth)}</ThemedText>
          </View>
        </Card>

        {stats.byCategory.length > 0 ? (
          <Card style={styles.chartCard}>
            <ThemedText type="smallBold">By category</ThemedText>
            <PieChart
              data={stats.byCategory}
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

        <Card style={styles.avgCard}>
          <ThemedText type="smallBold">Average per day</ThemedText>
          <AverageBar
            label="This month"
            value={stats.thisAvgPerDay}
            max={avgMax}
            active={range === 'thisMonth'}
          />
          <AverageBar
            label="Last month"
            value={stats.lastAvgPerDay}
            max={avgMax}
            active={range === 'lastMonth'}
          />
        </Card>

        {outstanding > 0 ? (
          <Pressable
            onPress={() => router.push('/owed')}
            style={({ pressed }) => (pressed ? styles.pressed : null)}>
            <Card>
              <View style={styles.owedHeader}>
                <ThemedText type="small" themeColor="textSecondary">
                  Owed to you
                </ThemedText>
                <ThemedText type="small" themeColor="accent">
                  View all ›
                </ThemedText>
              </View>
              <ThemedText type="title" style={styles.total}>
                {formatCurrency(outstanding)}
              </ThemedText>
            </Card>
          </Pressable>
        ) : null}

        {pendingReceipts > 0 ? (
          <Pressable
            onPress={() => router.push('/receive')}
            style={({ pressed }) => (pressed ? styles.pressed : null)}>
            <Card style={styles.banner}>
              <ThemedText type="smallBold">
                {pendingReceipts} payment{pendingReceipts === 1 ? '' : 's'} received — tap to review
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Match {pendingReceipts === 1 ? 'it' : 'them'} to who paid you back
              </ThemedText>
            </Card>
          </Pressable>
        ) : null}

        <ThemedText type="smallBold" style={styles.sectionTitle}>
          {RANGE_LABEL[range]}
        </ThemedText>

        {selectedCount === 0 ? (
          <EmptyState
            title={`No expenses in ${RANGE_LABEL[range].toLowerCase()}`}
            subtitle="Try the other range, or tap + to add one."
          />
        ) : (
          <Card style={styles.listCard}>
            {stats.selected.slice(0, 12).map((expense) => (
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
      </Screen>
      <DropletMenu
        onAddPress={() => startManual()}
        onReceivePress={() => router.push('/receive')}
      />
    </View>
  );
}

function AverageBar({
  label,
  value,
  max,
  active,
}: {
  label: string;
  value: number;
  max: number;
  active: boolean;
}) {
  const theme = useTheme();
  const ratio = max > 0 ? value / max : 0;
  // Keep a sliver visible for zero/near-zero values so the row still reads as a bar.
  const width = `${Math.min(100, Math.max(2, Math.round(ratio * 100)))}%` as const;

  return (
    <View style={styles.barRow}>
      <ThemedText
        type={active ? 'smallBold' : 'small'}
        themeColor={active ? 'text' : 'textSecondary'}
        style={styles.barLabel}>
        {label}
      </ThemedText>
      <View style={[styles.barTrack, { backgroundColor: theme.backgroundSelected }]}>
        <View
          style={[
            styles.barFill,
            { width, backgroundColor: active ? theme.accent : theme.textSecondary },
          ]}
        />
      </View>
      <ThemedText
        type={active ? 'smallBold' : 'small'}
        themeColor={active ? 'text' : 'textSecondary'}
        style={styles.barValue}>
        {formatCurrency(value)}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  total: {
    marginTop: Spacing.one,
  },
  filters: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  owedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing.two,
    paddingTop: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  pressed: {
    opacity: 0.7,
  },
  banner: {
    gap: Spacing.half,
  },
  chartCard: {
    alignItems: 'center',
  },
  avgCard: {
    gap: Spacing.two,
  },
  barRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  barLabel: {
    width: 80,
  },
  barTrack: {
    flex: 1,
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 4,
  },
  barValue: {
    minWidth: 72,
    textAlign: 'right',
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
