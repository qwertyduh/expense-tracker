import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Screen, ScreenHeader } from '@/components/ui/screen';
import { Spacing } from '@/constants/theme';
import type { SharedDebtRow } from '@/db/shared-debts';
import { formatCurrency, formatDate } from '@/lib/format';
import { useSharedDebts } from '@/hooks/use-shared-debts';
import { useTheme } from '@/hooks/use-theme';

function remaining(row: SharedDebtRow): number {
  return Math.max(0, Math.round((row.shareAmount - row.settledAmount) * 100) / 100);
}

export default function DebtsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { balances, rows, loading, error, settle } = useSharedDebts();
  const [busyId, setBusyId] = useState<string | null>(null);

  const pendingOwedByMe = useMemo(
    () =>
      rows.filter(
        (row) => row.direction === 'i_owe_them' && row.status === 'pending' && remaining(row) > 0
      ),
    [rows]
  );
  const pendingOwedToMe = useMemo(
    () =>
      rows.filter(
        (row) => row.direction === 'they_owe_me' && row.status === 'pending' && remaining(row) > 0
      ),
    [rows]
  );

  const pay = (row: SharedDebtRow) => {
    const amount = remaining(row);
    Alert.alert(
      `Pay ${formatCurrency(amount)} to @${row.counterpartyUsername}?`,
      'This marks the share as settled. It does not move money.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Mark paid',
          onPress: () => {
            setBusyId(row.participantId);
            settle(row, amount)
              .then((outcome) => {
                if (outcome.state === 'pending') {
                  Alert.alert(
                    'Saved',
                    'The payment will be recorded when you are back online.'
                  );
                }
              })
              .catch((err) =>
                Alert.alert(
                  'Could not settle',
                  err instanceof Error ? err.message : 'Try again.'
                )
              )
              .finally(() => setBusyId(null));
          },
        },
      ]
    );
  };

  return (
    <Screen>
      <Pressable onPress={() => router.back()} hitSlop={12}>
        <ThemedText type="small" themeColor="textSecondary">
          ‹ Back
        </ThemedText>
      </Pressable>
      <ScreenHeader
        title="Shared debts"
        subtitle={loading ? 'Syncing…' : 'Net balances with friends'}
      />

      {error ? (
        <ThemedText type="small" themeColor="danger">
          {error}
        </ThemedText>
      ) : null}

      {balances.length === 0 ? (
        <EmptyState
          title="All settled up"
          subtitle="Shared expenses with friends will appear here."
        />
      ) : (
        <Card style={styles.listCard}>
          {balances.map((balance) => (
            <View
              key={balance.userId}
              style={[styles.row, { borderColor: theme.border }]}>
              <View style={styles.rowMain}>
                <ThemedText type="default">{balance.displayName}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  @{balance.username}
                </ThemedText>
              </View>
              <View style={styles.amountSide}>
                <ThemedText
                  type="small"
                  themeColor={balance.net > 0 ? 'success' : 'danger'}>
                  {balance.net > 0 ? 'owes you' : 'you owe'}
                </ThemedText>
                <ThemedText type="smallBold">{formatCurrency(Math.abs(balance.net))}</ThemedText>
              </View>
            </View>
          ))}
        </Card>
      )}

      {pendingOwedByMe.length > 0 ? (
        <>
          <ThemedText type="smallBold">Payments to complete</ThemedText>
          <Card style={styles.listCard}>
            {pendingOwedByMe.map((row) => (
              <View key={row.participantId} style={[styles.row, { borderColor: theme.border }]}>
                <View style={styles.rowMain}>
                  <ThemedText type="default">
                    {row.label || 'Shared expense'}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    @{row.counterpartyUsername} · {formatDate(row.occurredAt)}
                  </ThemedText>
                </View>
                <View style={styles.amountSide}>
                  <ThemedText type="smallBold">{formatCurrency(remaining(row))}</ThemedText>
                  <Button
                    title="Mark paid"
                    onPress={() => pay(row)}
                    loading={busyId === row.participantId}
                  />
                </View>
              </View>
            ))}
          </Card>
        </>
      ) : null}

      {pendingOwedToMe.length > 0 ? (
        <>
          <ThemedText type="smallBold">Owed to you</ThemedText>
          <Card style={styles.listCard}>
            {pendingOwedToMe.map((row) => (
              <View key={row.participantId} style={[styles.row, { borderColor: theme.border }]}>
                <View style={styles.rowMain}>
                  <ThemedText type="default">
                    {row.label || 'Shared expense'}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    @{row.counterpartyUsername} · {formatDate(row.occurredAt)}
                  </ThemedText>
                </View>
                <View style={styles.amountSide}>
                  <ThemedText type="smallBold">{formatCurrency(remaining(row))}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    Waiting
                  </ThemedText>
                </View>
              </View>
            ))}
          </Card>
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  listCard: {
    paddingVertical: 0,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
    paddingVertical: Spacing.three,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowMain: {
    flexShrink: 1,
    gap: Spacing.half,
  },
  amountSide: {
    alignItems: 'flex-end',
    gap: Spacing.one,
  },
});
