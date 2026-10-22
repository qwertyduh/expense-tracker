import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import { Notice } from '@/components/ui/notice';
import { Screen, ScreenHeader } from '@/components/ui/screen';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { listAllCategories, type CategoryRow } from '@/db/categories';
import { listCachedAcceptedFriends, type CachedFriend } from '@/db/friends';
import {
  deleteExpense,
  getExpense,
  getExpenseParticipants,
  setExpenseSplit,
  updateExpense,
  type ExpenseRow,
  type ParticipantWithBalance,
} from '@/db/expenses';
import { rememberMerchant } from '@/db/merchant-memory';
import { useNotice } from '@/hooks/use-notice';
import { useTheme } from '@/hooks/use-theme';
import { syncExpenseAfterEdit } from '@/lib/expense-sync';
import { loadFriends } from '@/lib/friends';
import { formatCurrency, formatDateTime } from '@/lib/format';
import { sanitizeDecimal } from '@/lib/matching';
import { reconcileSelfEdit, reconcileSplitEdit } from '@/lib/split-edit';

type ParticipantDraft = {
  name: string;
  shareAmount: string;
  locked: boolean;
  username?: string | null;
  remoteUserId?: string | null;
};

export default function ExpenseDetailScreen() {
  const { id, edit } = useLocalSearchParams<{ id: string; edit?: string }>();
  const theme = useTheme();
  const router = useRouter();
  const { notice, showNotice } = useNotice();
  const [expense, setExpense] = useState<ExpenseRow | null>(null);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  // The add flow's "Confirm & edit amount" lands here with ?edit=1.
  const [editing, setEditing] = useState(edit === '1');
  const [participants, setParticipants] = useState<ParticipantWithBalance[]>([]);
  // `locked` marks a share the user hand-edited in this session: it is held
  // fixed while the remaining, still-unlocked participants absorb the
  // difference, so the shares always sum back to the bill.
  const [editedParticipants, setEditedParticipants] = useState<ParticipantDraft[]>([]);
  const [friends, setFriends] = useState<CachedFriend[]>(() => listCachedAcceptedFriends());

  const [categoryId, setCategoryId] = useState('');
  const [label, setLabel] = useState('');
  const [merchant, setMerchant] = useState('');
  const [total, setTotal] = useState('');
  const [share, setShare] = useState('');

  useEffect(() => {
    let active = true;
    loadFriends()
      .then(() => {
        if (active) setFriends(listCachedAcceptedFriends());
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

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
          locked: false,
          username: person.username,
          remoteUserId: person.remoteUserId,
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

  // Reconcile a proposed split edit and report back the next rows + self share,
  // or null when the edit must be rejected. Two guards protect the invariant
  // (self + participants === total): an amount larger than the bill, and a sum
  // that would overshoot it. Both surface a non-blocking notice instead of an
  // Alert, and leave the field untouched. When EVERY participant is locked the
  // difference has nowhere else to go, so it lands on your share — also
  // announced, so a readjusted "your share" never changes silently.
  const reconcile = (params: {
    rows: ParticipantDraft[];
    totalValue: number;
    selfValue: number;
    typedValue: number | null;
  }): { rows: ParticipantDraft[]; self: number; selfChanged: boolean } | null => {
    const result = reconcileSplitEdit({
      total: params.totalValue,
      self: params.selfValue,
      entries: params.rows.map((row) => ({
        amount: parseFloat(row.shareAmount) || 0,
        locked: row.locked,
      })),
      typedValue: params.typedValue,
    });
    if (!result.ok) {
      showNotice(result.message);
      return null;
    }
    if (result.notice) showNotice(result.notice);

    return {
      rows: params.rows.map((row, i) =>
        row.locked ? row : { ...row, shareAmount: String(result.shares[i]) }
      ),
      self: result.self,
      selfChanged: result.selfChanged,
    };
  };

  const editParticipantName = (index: number, value: string) => {
    setEditedParticipants((prev) =>
      prev.map((person, i) =>
        i === index
          ? { ...person, name: value, username: null, remoteUserId: null }
          : person
      )
    );
  };

  const applyEvenSplit = (rows: ParticipantDraft[]) => {
    const totalValue = parseFloat(total) || 0;
    const people = rows.length + 1;
    if (totalValue <= 0 || people <= 0) {
      setEditedParticipants(rows);
      return;
    }
    const each = Math.round((totalValue / people) * 100) / 100;
    const self = Math.round((totalValue - each * rows.length) * 100) / 100;
    setShare(String(self));
    setEditedParticipants(
      rows.map((row) => ({ ...row, shareAmount: String(each), locked: false }))
    );
  };

  const toggleFriend = (friend: CachedFriend) => {
    setEditedParticipants((prev) => {
      const selected = prev.some((row) => row.remoteUserId === friend.userId);
      const next = selected
        ? prev.filter((row) => row.remoteUserId !== friend.userId)
        : [
            ...prev,
            {
              name: friend.displayName,
              shareAmount: '0',
              locked: false,
              username: friend.username,
              remoteUserId: friend.userId,
            },
          ];
      applyEvenSplit(next);
      return next;
    });
  };

  const editParticipantShare = (index: number, value: string) => {
    const cleaned = sanitizeDecimal(value);
    // Lock the row the user just typed in, then rebalance the rest around it.
    const next: ParticipantDraft[] = editedParticipants.map((person, i) =>
      i === index ? { ...person, shareAmount: cleaned, locked: true } : person
    );
    const outcome = reconcile({
      rows: next,
      totalValue: parseFloat(total) || 0,
      selfValue: parseFloat(share) || 0,
      typedValue: parseFloat(cleaned) || 0,
    });
    if (!outcome) return;
    setEditedParticipants(outcome.rows);
    if (outcome.selfChanged) setShare(String(outcome.self));
  };

  const editSelfShare = (value: string) => {
    const cleaned = sanitizeDecimal(value);
    // An empty field means 0, not "do nothing".
    const typed = parseFloat(cleaned) || 0;
    const result = reconcileSelfEdit({
      total: parseFloat(total) || 0,
      self: typed,
      entries: editedParticipants.map((row) => ({
        amount: parseFloat(row.shareAmount) || 0,
        locked: row.locked,
      })),
    });
    if (!result.ok) {
      showNotice(result.message);
      return;
    }
    // Your field keeps its raw text (including empty); the FIRST participant
    // takes the whole difference and everyone else stays put.
    setShare(cleaned);
    setEditedParticipants(
      editedParticipants.map((row, i) =>
        i === 0 ? { ...row, shareAmount: String(result.shares[i]) } : row
      )
    );
  };

  const editTotal = (value: string) => {
    const cleaned = sanitizeDecimal(value);
    const typed = parseFloat(cleaned) || 0;
    if (cleaned === '' || typed <= 0) {
      setTotal(cleaned);
      return;
    }
    const outcome = reconcile({
      rows: editedParticipants,
      totalValue: typed,
      selfValue: parseFloat(share) || 0,
      typedValue: null,
    });
    if (!outcome) return;
    setTotal(cleaned);
    setEditedParticipants(outcome.rows);
    if (outcome.selfChanged) setShare(String(outcome.self));
  };

  const save = () => {
    const totalValue = parseFloat(total) || 0;
    const shareValue = parseFloat(share) || 0;
    if (totalValue <= 0 || !categoryId) return;
    const trimmedMerchant = merchant.trim() || null;
    // Persist edited participant shares alongside the row update.
    const nextParticipants = editedParticipants
      .map((person) => ({
        name: person.name.trim(),
        shareAmount: parseFloat(person.shareAmount) || 0,
        username: person.username ?? null,
        remoteUserId: person.remoteUserId ?? null,
      }))
      .filter((person) => person.name.length > 0);
    const splitPending = nextParticipants.length === 0 && shareValue < totalValue;
    updateExpense(expense.id, {
      categoryId,
      totalAmount: totalValue,
      selfShare: shareValue,
      label: label.trim() || null,
      merchant: trimmedMerchant,
      occurredAt: expense.occurred_at,
      splitPending,
    });
    setExpenseSplit(expense.id, shareValue, nextParticipants, splitPending);
    syncExpenseAfterEdit(expense.id);
    // Re-filing a vendor must retrain its memory too, so the next payment from
    // it opens with this new category instead of the one first learned.
    if (trimmedMerchant) {
      rememberMerchant(trimmedMerchant, categoryId, nextParticipants.length + 1);
    }
    setEditing(false);
    load();
  };

  const totalRemaining = participants.reduce((sum, person) => sum + person.remaining, 0);

  const remove = () => {
    const isShared =
      Boolean(expense.shared_expense_id) ||
      participants.some((person) => person.remoteUserId != null);
    Alert.alert(
      'Delete expense?',
      isShared
        ? 'This removes it from your history only. It stays in your friends\u2019 shared records.'
        : 'This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            deleteExpense(expense.id);
            router.back();
          },
        },
      ]
    );
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
            <Button title="Delete" variant="danger" onPress={remove} style={styles.deleteAction} />
            <Button title="Edit" variant="secondary" onPress={() => setEditing(true)} style={styles.action} />
          </View>

          <Button title="Back to home" onPress={() => router.replace('/')} />
        </>
      ) : (
        <>
          <Notice message={notice} />

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
            onChangeText={editTotal}
            keyboardType="decimal-pad"
            inputAccessoryViewButtonLabel="Done"
            style={inputStyle}
          />

          <ThemedText type="smallBold">Your share</ThemedText>
          <TextInput
            value={share}
            onChangeText={editSelfShare}
            keyboardType="decimal-pad"
            inputAccessoryViewButtonLabel="Done"
            style={inputStyle}
          />

          <ThemedText type="smallBold">Split with friends</ThemedText>
          {expense.split_pending ? (
            <ThemedText type="small" style={{ color: theme.danger }}>
              This split needs people and shares before it is complete.
            </ThemedText>
          ) : null}
          {friends.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary">
              No linked friends yet. Add a local person below, or add friends from
              Settings → Friends.
            </ThemedText>
          ) : (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chips}>
              {friends.map((friend) => (
                <Chip
                  key={friend.userId}
                  label={`@${friend.username}`}
                  selected={editedParticipants.some(
                    (row) => row.remoteUserId === friend.userId
                  )}
                  onPress={() => toggleFriend(friend)}
                />
              ))}
            </ScrollView>
          )}

          <View style={styles.participantHeader}>
            <ThemedText type="small" themeColor="textSecondary">
              {editedParticipants.length + 1} people including you
            </ThemedText>
            <Pressable
              onPress={() => {
                const next: ParticipantDraft[] = [
                  ...editedParticipants,
                  { name: '', shareAmount: '0', locked: false },
                ];
                applyEvenSplit(next);
              }}>
              <ThemedText type="linkPrimary">+ Local person</ThemedText>
            </Pressable>
          </View>

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
                    inputAccessoryViewButtonLabel="Done"
                    style={[inputStyle, styles.participantName]}
                  />
                  <TextInput
                    value={person.shareAmount}
                    onChangeText={(value) => editParticipantShare(index, value)}
                    keyboardType="decimal-pad"
                    inputAccessoryViewButtonLabel="Done"
                    style={[inputStyle, styles.participantShare]}
                  />
                </View>
              ))}
            </>
          )}

          <ThemedText type="smallBold">Label</ThemedText>
          <TextInput
            value={label}
            onChangeText={setLabel}
            inputAccessoryViewButtonLabel="Done"
            style={inputStyle}
          />

          <ThemedText type="smallBold">Merchant</ThemedText>
          <TextInput
            value={merchant}
            onChangeText={setMerchant}
            inputAccessoryViewButtonLabel="Done"
            style={inputStyle}
          />

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
  deleteAction: {
    paddingHorizontal: Spacing.four,
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
  participantHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
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
