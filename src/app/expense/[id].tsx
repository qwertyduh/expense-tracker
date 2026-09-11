import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import { Screen, ScreenHeader } from '@/components/ui/screen';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { listAllCategories, type CategoryRow } from '@/db/categories';
import { deleteExpense, getExpense, updateExpense, type ExpenseRow } from '@/db/expenses';
import { useTheme } from '@/hooks/use-theme';
import { formatCurrency, formatDateTime } from '@/lib/format';

export default function ExpenseDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const router = useRouter();
  const [expense, setExpense] = useState<ExpenseRow | null>(null);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [editing, setEditing] = useState(false);

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
    setEditing(false);
    load();
  };

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

          <View style={styles.actions}>
            <Button title="Edit" variant="secondary" onPress={() => setEditing(true)} style={styles.action} />
            <Button title="Delete" variant="danger" onPress={remove} style={styles.action} />
          </View>
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
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: 16,
  },
});
