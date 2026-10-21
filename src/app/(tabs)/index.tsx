import { DateTimePicker } from '@expo/ui/community/datetime-picker';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Animated, Dimensions, Platform, Pressable, StyleSheet, View } from 'react-native';
import { PieChart } from 'react-native-chart-kit';

import { Card } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import { EmptyState } from '@/components/ui/empty-state';
import { DropletMenu } from '@/components/ui/droplet-menu';
import { ListRow } from '@/components/ui/list-row';
import { Screen, ScreenHeader } from '@/components/ui/screen';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import {
  listExpenses,
  listPendingSplitExpenses,
  type ExpenseRow,
} from '@/db/expenses';
import { countPendingIncomingReceipts } from '@/db/incoming-receipts';
import { receivedTotalSince, totalOutstanding } from '@/db/settlements';
import { useAddExpenseIntentContext } from '@/hooks/add-expense-intent-provider';
import { useSharedDebts } from '@/hooks/use-shared-debts';
import { useTheme } from '@/hooks/use-theme';
import {
  EXPENSE_PRESETS,
  expenseRange,
  presetLabel,
  rangeDayCount,
  type ExpensePreset,
} from '@/lib/expense-range';
import { useExpensesChanged } from '@/lib/expenses-changed';
import { formatCurrency, formatDate, formatRelative, monthKey, monthLabel } from '@/lib/format';

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

type CustomField = 'from' | 'to';

function isWithin(iso: string, range: { from?: string; to?: string }): boolean {
  if (range.from && iso < range.from) return false;
  if (range.to && iso > range.to) return false;
  return true;
}

export default function HomeScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { startManual } = useAddExpenseIntentContext();
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [pendingSplits, setPendingSplits] = useState<ExpenseRow[]>([]);
  const [preset, setPreset] = useState<ExpensePreset>('thisMonth');
  const [customFrom, setCustomFrom] = useState<Date>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 6);
    return d;
  });
  const [customTo, setCustomTo] = useState<Date>(() => new Date());
  const [picking, setPicking] = useState<CustomField | null>(null);
  const [receivedThisMonth, setReceivedThisMonth] = useState(0);
  const [outstanding, setOutstanding] = useState(0);
  const [pendingReceipts, setPendingReceipts] = useState(0);
  const { balances: sharedBalances } = useSharedDebts();

  // Drives the inline picker's close/open so moving from the start date to the
  // end date is visible rather than an instant, silent swap.
  const [pickerAnim] = useState(() => new Animated.Value(0));

  const range = useMemo(
    () => expenseRange({ preset, customFrom, customTo }),
    [preset, customFrom, customTo]
  );

  const reload = useCallback(() => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthStartIso = monthStart.toISOString();
    // One query covers both the selected range and the current month (the
    // per-day average baseline), so fetch from whichever starts earlier.
    const fetchFrom = range.from == null ? undefined : range.from < monthStartIso ? range.from : monthStartIso;

    setExpenses(listExpenses({ from: fetchFrom, limit: 1000 }));
    setPendingSplits(listPendingSplitExpenses());
    setReceivedThisMonth(receivedTotalSince(monthStartIso));
    setOutstanding(totalOutstanding());
    setPendingReceipts(countPendingIncomingReceipts());
  }, [range]);

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
    const selected = preset === 'all' ? expenses : expenses.filter((e) => isWithin(e.occurred_at, range));
    const sum = (rows: ExpenseRow[]) => rows.reduce((total, e) => total + e.amount, 0);

    const thisTotal = sum(thisMonthExpenses);
    const selectedTotal = sum(selected);

    const thisAvgPerDay = thisTotal / Math.max(1, now.getDate());
    // Rows are newest-first, so the last one is the earliest loaded.
    const earliest = expenses.length > 0 ? expenses[expenses.length - 1].occurred_at : null;
    const selectedAvgPerDay = selectedTotal / rangeDayCount(range, now, earliest);

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

    const rangeLabel =
      preset === 'thisMonth'
        ? monthLabel(thisKey)
        : preset === 'lastMonth'
          ? monthLabel(lastKey)
          : presetLabel(preset);

    return {
      selected,
      selectedTotal,
      thisAvgPerDay,
      selectedAvgPerDay,
      byCategory,
      rangeLabel,
    };
  }, [expenses, theme.text, preset, range]);

  const sharedNet = useMemo(
    () => sharedBalances.reduce((sum, balance) => sum + balance.net, 0),
    [sharedBalances]
  );
  const chartWidth = Math.min(Dimensions.get('window').width, 800) - Spacing.four * 2 - Spacing.three * 2;
  const avgMax = Math.max(stats.thisAvgPerDay, stats.selectedAvgPerDay);
  const rangeSubtitle =
    preset === 'custom'
      ? `${formatDate(customFrom.toISOString())} – ${formatDate(customTo.toISOString())}`
      : stats.rangeLabel;

  const openPicker = useCallback(
    (field: CustomField) => {
      setPicking(field);
      pickerAnim.setValue(0);
      Animated.timing(pickerAnim, {
        toValue: 1,
        duration: 160,
        useNativeDriver: true,
      }).start();
    },
    [pickerAnim]
  );

  const onPick = useCallback(
    (field: CustomField, date: Date) => {
      if (field === 'from') {
        setCustomFrom(date);
        // Snap shut, then reopen for the end date so the switch from start to
        // end is an obvious, animated hand-off.
        Animated.timing(pickerAnim, {
          toValue: 0,
          duration: 110,
          useNativeDriver: true,
        }).start(() => {
          setPicking('to');
          pickerAnim.setValue(0);
          Animated.timing(pickerAnim, {
            toValue: 1,
            duration: 160,
            useNativeDriver: true,
          }).start();
        });
      } else {
        setCustomTo(date);
      }
    },
    [pickerAnim]
  );

  const pickerValue = picking === 'to' ? customTo : customFrom;

  return (
    <View style={styles.container}>
      <Screen>
        <ScreenHeader title="Expenses" subtitle={`${rangeSubtitle} · your share`} />

        {pendingSplits.length > 0 ? (
          <Card style={styles.pendingCard}>
            <ThemedText type="smallBold" style={{ color: theme.danger }}>
              Split needs people
            </ThemedText>
            {pendingSplits.map((expense) => (
              <Pressable
                key={expense.id}
                onPress={() => router.push(`/expense/${expense.id}?edit=1`)}
                style={({ pressed }) => [
                  styles.pendingRow,
                  { borderColor: theme.border },
                  pressed ? styles.pressed : null,
                ]}>
                <View style={styles.pendingMain}>
                  <ThemedText type="default" numberOfLines={1} style={{ color: theme.danger }}>
                    {expense.merchant ?? expense.label ?? expense.category_name ?? 'Expense'}
                  </ThemedText>
                  <ThemedText type="small" style={{ color: theme.danger }}>
                    {formatCurrency(expense.total_amount)} · tap to assign people
                  </ThemedText>
                </View>
                <ThemedText type="smallBold" style={{ color: theme.danger }}>
                  {formatRelative(expense.occurred_at)}
                </ThemedText>
              </Pressable>
            ))}
          </Card>
        ) : null}

        <Card style={styles.filterCard}>
          <View style={styles.filters}>
            {EXPENSE_PRESETS.map((item) => (
              <Chip
                key={item.id}
                label={item.label}
                selected={item.id === preset}
                onPress={() => {
                  setPreset(item.id);
                  setPicking(null);
                }}
              />
            ))}
          </View>

          {preset === 'custom' ? (
            <>
              <View style={styles.customRow}>
                <DateField
                  label="From"
                  date={customFrom}
                  active={picking === 'from'}
                  onPress={() => openPicker('from')}
                />
                <DateField
                  label="To"
                  date={customTo}
                  active={picking === 'to'}
                  onPress={() => openPicker('to')}
                />
              </View>

              {picking ? (
                <Animated.View
                  style={{
                    opacity: pickerAnim,
                    transform: [
                      {
                        translateY: pickerAnim.interpolate({
                          inputRange: [0, 1],
                          outputRange: [-6, 0],
                        }),
                      },
                    ],
                  }}>
                  <DateTimePicker
                    key={picking}
                    value={pickerValue}
                    mode="date"
                    presentation="dialog"
                    display={Platform.OS === 'ios' ? 'inline' : 'default'}
                    minimumDate={picking === 'to' ? customFrom : undefined}
                    maximumDate={picking === 'from' ? customTo : new Date()}
                    accentColor={theme.accent}
                    onValueChange={(_event, date) => onPick(picking, date)}
                    onDismiss={() => setPicking(null)}
                  />
                </Animated.View>
              ) : null}
            </>
          ) : null}
        </Card>

        <Card>
          <ThemedText type="small" themeColor="textSecondary">
            Spent · {rangeSubtitle}
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
            active={preset === 'thisMonth'}
          />
          {preset === 'thisMonth' ? null : (
            <AverageBar
              label={stats.rangeLabel}
              value={stats.selectedAvgPerDay}
              max={avgMax}
              active
            />
          )}
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

        {sharedBalances.length > 0 ? (
          <Pressable
            onPress={() => router.push('/debts')}
            style={({ pressed }) => (pressed ? styles.pressed : null)}>
            <Card>
              <View style={styles.owedHeader}>
                <ThemedText type="small" themeColor="textSecondary">
                  Shared with friends
                </ThemedText>
                <ThemedText type="small" themeColor="accent">
                  View all ›
                </ThemedText>
              </View>
              <ThemedText
                type="title"
                style={[
                  styles.total,
                  { color: sharedNet >= 0 ? theme.success : theme.danger },
                ]}>
                {formatCurrency(Math.abs(sharedNet))}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {sharedNet >= 0 ? 'Owed to you' : 'You owe'}
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
          Recent · {stats.rangeLabel}
        </ThemedText>

        {stats.selected.length === 0 ? (
          <EmptyState
            title={`No expenses in ${stats.rangeLabel.toLowerCase()}`}
            subtitle="Try a wider range, or tap + to add one."
          />
        ) : (
          <Card style={styles.listCard}>
            {stats.selected.slice(0, 12).map((expense) => (
              <ListRow
                key={expense.id}
                title={expense.merchant ?? expense.label ?? expense.category_name ?? 'Expense'}
                subtitle={`${expense.category_name ?? 'Uncategorized'} · ${formatRelative(expense.occurred_at)}`}
                value={formatCurrency(expense.amount)}
                danger={expense.split_pending === 1}
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
        style={styles.barLabel}
        numberOfLines={1}>
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

function DateField({
  label,
  date,
  active,
  onPress,
}: {
  label: string;
  date: Date;
  active: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.dateField,
        {
          borderColor: active ? theme.accent : theme.border,
          backgroundColor: theme.background,
        },
        pressed && { opacity: 0.7 },
      ]}>
      <ThemedText type="small" themeColor={active ? 'accent' : 'textSecondary'}>
        {label}
      </ThemedText>
      <ThemedText type="smallBold">{formatDate(date.toISOString())}</ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  total: {
    marginTop: Spacing.one,
  },
  filterCard: {
    gap: Spacing.three,
  },
  pendingCard: {
    gap: Spacing.one,
  },
  pendingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
    paddingVertical: Spacing.three,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  pendingMain: {
    flexShrink: 1,
    gap: Spacing.half,
  },
  filters: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  customRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  dateField: {
    flex: 1,
    gap: Spacing.half,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
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
