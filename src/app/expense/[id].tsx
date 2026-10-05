import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import { Screen, ScreenHeader } from '@/components/ui/screen';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { listAllCategories, type CategoryRow } from '@/db/categories';
import {
  deleteExpense,
  getExpense,
  getExpenseParticipants,
  setExpenseSplit,
  updateExpense,
  type ExpenseRow,
  type ParticipantWithBalance,
} from '@/db/expenses';
import { useAddExpenseIntentContext } from '@/hooks/add-expense-intent-provider';
import { useTheme } from '@/hooks/use-theme';
import { formatCurrency, formatDateTime } from '@/lib/format';

export default function ExpenseDetailScreen() {
  const { id, edit } = useLocalSearchParams<{ id: string; edit?: string }>();
  const theme = useTheme();
  const router = useRouter();
  const { startReceive } = useAddExpenseIntentContext();
  const [expense, setExpense] = useState<ExpenseRow | null>(null);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  // The add flow's "Confirm & edit amount" lands here with ?edit=1.
  const [editing, setEditing] = useState(edit === '1');
  const [participants, setParticipants] = useState<ParticipantWithBalance[]>([]);
  const [editedParticipants, setEditedParticipants] = useState<
    { name: string; shareAmount: string }[]
  >([]);

  const [categoryId, setCategoryId] = useState('');
  const [label, setLabel] = useState('');
  const [merchant, setMerchant] = useState('');
  const [total, setTotal] = useState('');
  const [share, setShare] = useState('');

  const load = useCallback(() => {
    if (!id) return;
    const row = getExpense(id);
    setExpense(row);
    setCategories(listAllCategories());
    if (row) {
      setCategoryId(row.category_id);
      setLabel(row.label ?? '');
      setMerchant(row.merchant ?? '');
      setTotal(String(row.total_amount));
      setShare(String(row.amount));
      const people = getExpenseParticipants(row.id);
      setParticipants(people);
      setEditedParticipants(
        people.map((person) => ({
          name: person.personName,
          shareAmount: String(person.shareAmount),
        }))
      );
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  if (!expense) {
    return (
      <Screen>
        <ScreenHeader title="Expense" />
        <ThemedText type="small" themeColor="textSecondary">
          Not found.
        </ThemedText>
      </Screen>
    );
  }

  const editParticipantName = (index: number, value: string) => {
    setEditedParticipants((prev) =>
      prev.map((person, i) => (i === index ? { ...person, name: value } : person))
    );
  };

  const editParticipantShare = (index: number, value: string) => {
    setEditedParticipants((prev) =>
      prev.map((person, i) => (i === index ? { ...person, shareAmount: value } : person))
    );
  };

  const save = () => {
    const totalValue = parseFloat(total) || 0;
    const shareValue = parseFloat(share) || 0;
    if (totalValue <= 0 || !categoryId) return;
    updateExpense(expense.id, {
      categoryId,
      totalAmount: totalValue,
      selfShare: shareValue,
      label: label.trim() || null,
      merchant: merchant.trim() || null,
      occurredAt: expense.occurred_at,
    });
    // Persist edited participant shares alongside the row update.
    const nextParticipants = editedParticipants
      .map((person) => ({
        name: person.name.trim(),
        shareAmount: parseFloat(person.shareAmount) || 0,
      }))
      .filter((person) => person.name.length > 0);
    setExpenseSplit(expense.id, shareValue, nextParticipants);
    setEditing(false);
    load();
  };

  const totalRemaining = participants.reduce((sum, person) => sum + person.remaining, 0);

  const remove = () => {
    Alert.alert('Delete expense?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          deleteExpense(expense.id);
          router.back();
        },
      },
    ]);
  };

  const inputStyle = [
    styles.input,
    { color: theme.text, backgroundColor: theme.backgroundElement, borderColor: theme.border },
  ];

  return (
    <Screen>
      <ScreenHeader
        title={expense.merchant ?? expense.label ?? 'Expense'}
        subtitle={formatDateTime(expense.occurred_at)}
      />

      {!editing ? (
        <>
          <Card>
            <ThemedText type="small" themeColor="textSecondary">
              Your share
            </ThemedText>
            <ThemedText type="title">{formatCurrency(expense.amount)}</ThemedText>
            {expense.is_split ? (
              <ThemedText type="small" themeColor="textSecondary">
                Bill {formatCurrency(expense.total_amount)} · split
              </ThemedText>
            ) : null}
          </Card>

          <Card style={styles.rows}>
            <Row k="Category" v={expense.category_name ?? 'Uncategorized'} />
            <Row k="Label" v={expense.label ?? '—'} />
            <Row k="Merchant" v={expense.merchant ?? '—'} />
            <Row k="Source" v={expense.bank_source ?? expense.source} />
          </Card>

          {expense.is_split && participants.length > 0 && (
            <Card style={styles.rows}>
              <ThemedText type="smallBold">Split / repayments</ThemedText>
              {participants.map((person) => (
                <View key={person.personId} style={styles.repaymentRow}>
                  <ThemedText type="default" style={styles.repaymentName}>
                    {person.personName}
                  </ThemedText>
                  <View style={styles.repaymentAmounts}>
                    <ThemedText type="small" themeColor="textSecondary">
                      Share {formatCurrency(person.shareAmount)}
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      Received {formatCurrency(person.receivedAmount)}
                    </ThemedText>
                    <ThemedText
                      type="small"
                      themeColor={person.remaining > 0 ? 'danger' : 'success'}>
                      Remaining {formatCurrency(person.remaining)}
                    </ThemedText>
                  </View>
                </View>
              ))}
              <View style={styles.detailRow}>
                <ThemedText type="smallBold">Still owed</ThemedText>
                <ThemedText type="smallBold">{formatCurrency(totalRemaining)}</ThemedText>
              </View>
            </Card>
          )}

          <View style={styles.actions}>
            <Button title="Edit" variant="secondary" onPress={() => setEditing(true)} style={styles.action} />
            <Button title="Delete" variant="danger" onPress={remove} style={styles.action} />
          </View>

          {expense.is_split && participants.length > 0 && (
            <Button
              title="Record repayment"
              onPress={() => startReceive({ source: 'expense', expenseId: expense.id })}
            />
          )}
        </>
      ) : (
        <>
          <ThemedText type="smallBold">Category</ThemedText>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            {categories.map((category) => (
              <Chip
                key={category.id}
                label={category.name}
                selected={category.id === categoryId}
                onPress={() => setCategoryId(category.id)}
              />
            ))}
          </ScrollView>

          <ThemedText type="smallBold">Total bill</ThemedText>
          <TextInput
            value={total}
            onChangeText={setTotal}
            keyboardType="decimal-pad"
            style={inputStyle}
          />

          <ThemedText type="smallBold">Your share</ThemedText>
          <TextInput
            value={share}
            onChangeText={setShare}
            keyboardType="decimal-pad"
            style={inputStyle}
          />

          {editedParticipants.length > 0 && (
            <>
              <ThemedText type="smallBold">Participants</ThemedText>
              {editedParticipants.map((person, index) => (
                <View key={index} style={styles.participantRow}>
                  <TextInput
                    value={person.name}
                    onChangeText={(value) => editParticipantName(index, value)}
                    placeholder="Name"
                    placeholderTextColor={theme.textSecondary}
                    style={[inputStyle, styles.participantName]}
                  />
                  <TextInput
                    value={person.shareAmount}
                    onChangeText={(value) => editParticipantShare(index, value)}
                    keyboardType="decimal-pad"
                    style={[inputStyle, styles.participantShare]}
                  />
                </View>
              ))}
            </>
          )}

          <ThemedText type="smallBold">Label</ThemedText>
          <TextInput value={label} onChangeText={setLabel} style={inputStyle} />

          <ThemedText type="smallBold">Merchant</ThemedText>
          <TextInput value={merchant} onChangeText={setMerchant} style={inputStyle} />

          <View style={styles.actions}>
            <Button title="Cancel" variant="ghost" onPress={() => setEditing(false)} style={styles.action} />
            <Button title="Save" onPress={save} style={styles.action} />
          </View>
        </>
      )}
    </Screen>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <View style={styles.detailRow}>
      <ThemedText type="small" themeColor="textSecondary">
        {k}
      </ThemedText>
      <ThemedText type="default" style={styles.detailValue}>
        {v}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  rows: {
    gap: Spacing.one,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: Spacing.four,
    paddingVertical: Spacing.two,
  },
  detailValue: {
    flexShrink: 1,
    textAlign: 'right',
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing.three,
    marginTop: Spacing.two,
  },
  action: {
    flex: 1,
  },
  chips: {
    gap: Spacing.two,
    paddingVertical: Spacing.one,
  },
  repaymentRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: Spacing.three,
    paddingVertical: Spacing.two,
  },
  repaymentName: {
    flexShrink: 1,
    fontWeight: '600',
  },
  repaymentAmounts: {
    alignItems: 'flex-end',
    gap: Spacing.half,
  },
  participantRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  participantName: {
    flex: 1,
  },
  participantShare: {
    width: 110,
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: 16,
  },
});
