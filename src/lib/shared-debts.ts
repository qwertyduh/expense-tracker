import {
  replaceSharedDebtCache,
  type SharedDebtRow,
} from '@/db/shared-debts';
import { db } from '@/db/schema';
import {
  enqueueSettlement,
  flushOutbox,
  getSettlementState,
  type SettlementMethod,
  type SettlementState,
} from '@/lib/sync';
import { supabase } from '@/lib/supabase';

type RemoteParticipant = {
  id: string;
  user_id: string;
  share_amount: number;
  settled_amount: number;
  status: 'pending' | 'paid' | 'disputed';
  updated_at: string;
};

type RemoteExpense = {
  id: string;
  owner_id: string;
  total_amount: number;
  label: string | null;
  occurred_at: string;
  status: 'active' | 'voided';
  participants: RemoteParticipant[];
};

type ProfileRow = {
  id: string;
  username: string;
  display_name: string;
};

export type { SettlementMethod };
export type SettleOutcome = SettlementState;

export async function pullSharedDebts(): Promise<SharedDebtRow[]> {
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;
  const me = auth.user?.id;
  if (!me) return [];

  const { data, error } = await supabase
    .from('shared_expenses')
    .select(
      `id, owner_id, total_amount, label, occurred_at, status,
       participants:shared_expense_participants(
         id, user_id, share_amount, settled_amount, status, updated_at
       )`
    )
    .eq('status', 'active');
  if (error) throw error;

  const expenses = (data ?? []) as RemoteExpense[];
  const counterpartyIds = new Set<string>();
  for (const expense of expenses) {
    if (expense.owner_id === me) {
      for (const participant of expense.participants) {
        if (participant.user_id !== me) counterpartyIds.add(participant.user_id);
      }
    } else if (expense.participants.some((participant) => participant.user_id === me)) {
      counterpartyIds.add(expense.owner_id);
    }
  }

  let profiles = new Map<string, ProfileRow>();
  if (counterpartyIds.size > 0) {
    const { data: profileRows, error: profileError } = await supabase
      .from('profiles')
      .select('id, username, display_name')
      .in('id', [...counterpartyIds]);
    if (profileError) throw profileError;
    profiles = new Map(
      ((profileRows ?? []) as ProfileRow[]).map((profile) => [profile.id, profile])
    );
  }

  // Account switched while this pull was in flight: never write another
  // user's debts into the cache.
  const current = await supabase.auth.getSession();
  if (current.data.session?.user.id !== me) return [];

  const rows: SharedDebtRow[] = [];
  const syncedExpenseIds: string[] = [];

  for (const expense of expenses) {
    if (expense.owner_id === me) {
      syncedExpenseIds.push(expense.id);
      for (const participant of expense.participants) {
        if (participant.user_id === me) continue;
        const profile = profiles.get(participant.user_id);
        if (!profile) continue;
        rows.push({
          participantId: participant.id,
          expenseId: expense.id,
          direction: 'they_owe_me',
          counterpartyUserId: profile.id,
          counterpartyUsername: profile.username,
          counterpartyDisplayName: profile.display_name,
          totalAmount: expense.total_amount,
          label: expense.label,
          occurredAt: expense.occurred_at,
          shareAmount: participant.share_amount,
          settledAmount: participant.settled_amount,
          status: participant.status,
          updatedAt: participant.updated_at,
        });
      }
      continue;
    }

    const mine = expense.participants.find((participant) => participant.user_id === me);
    if (!mine) continue;
    const owner = profiles.get(expense.owner_id);
    if (!owner) continue;
    rows.push({
      participantId: mine.id,
      expenseId: expense.id,
      direction: 'i_owe_them',
      counterpartyUserId: owner.id,
      counterpartyUsername: owner.username,
      counterpartyDisplayName: owner.display_name,
      totalAmount: expense.total_amount,
      label: expense.label,
      occurredAt: expense.occurred_at,
      shareAmount: mine.share_amount,
      settledAmount: mine.settled_amount,
      status: mine.status,
      updatedAt: mine.updated_at,
    });
  }

  replaceSharedDebtCache(rows);

  if (syncedExpenseIds.length > 0) {
    const placeholders = syncedExpenseIds.map(() => '?').join(',');
    db.runSync(
      `UPDATE expenses SET sync_status = 'synced', updated_at = ?
        WHERE id IN (${placeholders})`,
      new Date().toISOString(),
      ...syncedExpenseIds
    );
  }

  return rows;
}

// Enqueue first, then flush. The intent and its idempotency key are durable, so
// a lost response, an app kill, or a later retry reuses the same key and the
// server returns the original settlement instead of crediting the share twice.
export async function settleSharedDebt(input: {
  participantId: string;
  expenseId: string;
  amount: number;
  method: SettlementMethod;
}): Promise<SettleOutcome> {
  const { intentId } = enqueueSettlement(input);
  await flushOutbox().catch(() => {});
  return getSettlementState(intentId);
}

export function subscribeToSharedDebts(onChange: () => void) {
  const channel = supabase
    .channel(`shared-debts-${Math.random().toString(36).slice(2)}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'shared_expense_participants' },
      onChange
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'shared_expenses' },
      onChange
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}
