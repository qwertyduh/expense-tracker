import { DateTimePicker } from '@expo/ui/community/datetime-picker';
import { useFocusEffect } from 'expo-router';
import { Fragment, useCallback, useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Card } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import { EmptyState } from '@/components/ui/empty-state';
import { ListRow } from '@/components/ui/list-row';
import { Screen, ScreenHeader } from '@/components/ui/screen';
import { Spacing } from '@/constants/theme';
import { listActivity, type ActivityRow } from '@/db/activity';
import { useTheme } from '@/hooks/use-theme';
import { activityGroupMode, groupForDate } from '@/lib/activity-group';
import {
  ACTIVITY_PRESETS,
  activityRange,
  type ActivityPreset,
} from '@/lib/activity-range';
import { useExpensesChanged } from '@/lib/expenses-changed';
import { formatCurrency, formatDate, formatRelative } from '@/lib/format';

const ACTION_LABEL: Record<ActivityRow['action'], string> = {
  created: 'Added',
  edited: 'Edited',
  deleted: 'Deleted',
};

type CustomField = 'from' | 'to';

export default function HistoryScreen() {
  const theme = useTheme();
  const [events, setEvents] = useState<ActivityRow[]>([]);
  const [preset, setPreset] = useState<ActivityPreset>('last7');
  const [customFrom, setCustomFrom] = useState<Date>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 6);
    return d;
  });
  const [customTo, setCustomTo] = useState<Date>(() => new Date());
  const [picking, setPicking] = useState<CustomField | null>(null);

  const range = useMemo(
    () => activityRange({ preset, customFrom, customTo }),
    [preset, customFrom, customTo]
  );

  const reload = useCallback(() => {
    setEvents(listActivity({ limit: 500, range }));
  }, [range]);

  useFocusEffect(reload);
  // Refresh in place when a capture is auto-logged on foreground.
  useExpensesChanged(reload);

  const mode = useMemo(() => activityGroupMode(range), [range]);
  const groups = useMemo(() => {
    const out: { key: string; label: string; events: ActivityRow[] }[] = [];
    for (const event of events) {
      const { key, label } = groupForDate(event.occurred_at, mode);
      const last = out[out.length - 1];
      if (last && last.key === key) last.events.push(event);
      else out.push({ key, label, events: [event] });
    }
    return out;
  }, [events, mode]);

  const choosePreset = useCallback((next: ActivityPreset) => {
    setPreset(next);
    setPicking(null);
  }, []);

  const onPick = useCallback((field: CustomField, date: Date) => {
    if (field === 'from') {
      // Chain straight into the end date so both are set in one pass.
      setCustomFrom(date);
      setPicking('to');
    } else {
      setCustomTo(date);
      setPicking(null);
    }
  }, []);

  const pickerValue = picking === 'to' ? customTo : customFrom;

  return (
    <Screen>
      <ScreenHeader title="History" subtitle="Every add, edit and delete" />

      <Card style={styles.filterCard}>
        <View style={styles.filters}>
          {ACTIVITY_PRESETS.map((item) => (
            <Chip
              key={item.id}
              label={item.label}
              selected={item.id === preset}
              onPress={() => choosePreset(item.id)}
            />
          ))}
        </View>

        {preset === 'custom' ? (
          <>
            <View style={styles.customRow}>
              <DateField
                label="From"
                date={customFrom}
                onPress={() => setPicking('from')}
              />
              <DateField label="To" date={customTo} onPress={() => setPicking('to')} />
            </View>

            {picking ? (
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
            ) : null}
          </>
        ) : null}
      </Card>

      {events.length === 0 ? (
        <EmptyState
          title={preset === 'all' ? 'Nothing yet' : 'No activity in this range'}
          subtitle={
            preset === 'all'
              ? 'Activity will appear here as you add expenses.'
              : 'Try a wider range, or add an expense to see it here.'
          }
        />
      ) : (
        <Card style={styles.listCard}>
          {groups.map((group, index) => (
            <Fragment key={group.key}>
              <View
                style={[
                  styles.groupHeader,
                  index > 0 && { borderTopColor: theme.border, borderTopWidth: StyleSheet.hairlineWidth },
                ]}>
                <ThemedText type="small" themeColor="textSecondary">
                  {group.label}
                </ThemedText>
              </View>
              {group.events.map((event) => {
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
            </Fragment>
          ))}
        </Card>
      )}
    </Screen>
  );
}

function DateField({
  label,
  date,
  onPress,
}: {
  label: string;
  date: Date;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.dateField,
        { borderColor: theme.border, backgroundColor: theme.background },
        pressed && { opacity: 0.7 },
      ]}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <ThemedText type="smallBold">{formatDate(date.toISOString())}</ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  filterCard: {
    gap: Spacing.three,
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
  groupHeader: {
    paddingTop: Spacing.three,
    paddingBottom: Spacing.one,
  },
  listCard: {
    paddingVertical: 0,
  },
});
