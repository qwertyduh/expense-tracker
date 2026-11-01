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

const PAGE_SIZE = 500;
const PROFILE_CHUNK = 100;

export async function pullSharedDebts(): Promise<SharedDebtRow[]> {
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;
  const me = auth.user?.id;
  if (!me) return [];

  // PostgREST caps a response (1000 rows by default) and the cache is replaced
  // wholesale below, so a single unpaged select would silently delete every
  // debt past the cap. Page by id until a short page.
  const expenses: RemoteExpense[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('shared_expenses')
      .select(
        `id, owner_id, total_amount, label, occurred_at, status,
         participants:shared_expense_participants(
           id, user_id, share_amount, settled_amount, status, updated_at
         )`
      )
      .eq('status', 'active')
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const page = (data ?? []) as RemoteExpense[];
    expenses.push(...page);
    if (page.length < PAGE_SIZE) break;
  }

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

  const profiles = new Map<string, ProfileRow>();
  const ids = [...counterpartyIds];
  for (let i = 0; i < ids.length; i += PROFILE_CHUNK) {
    const { data: profileRows, error: profileError } = await supabase
      .from('profiles')
      .select('id, username, display_name')
      .in('id', ids.slice(i, i + PROFILE_CHUNK));
    if (profileError) throw profileError;
    for (const profile of (profileRows ?? []) as ProfileRow[]) {
      profiles.set(profile.id, profile);
    }
  }

  // A debt must never vanish because its counterparty's profile is not
  // readable; show it under a placeholder name instead of dropping the row.
  const profileFor = (id: string): ProfileRow =>
    profiles.get(id) ?? { id, username: 'unknown', display_name: 'Unknown user' };

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
        const profile = profileFor(participant.user_id);
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
    const owner = profileFor(expense.owner_id);
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

  // Mark local rows synced only when nothing for them is still queued or
  // failed; otherwise the UI would claim a pending edit already reached the
  // server just because an older version of the expense exists there.
  if (syncedExpenseIds.length > 0) {
    const placeholders = syncedExpenseIds.map(() => '?').join(',');
    db.runSync(
      `UPDATE expenses SET sync_status = 'synced', updated_at = ?
        WHERE (id IN (${placeholders}) OR shared_expense_id IN (${placeholders}))
          AND NOT EXISTS (
            SELECT 1 FROM sync_outbox o
             WHERE o.entity_type = 'shared_expense'
               AND (o.entity_id = expenses.id OR o.entity_id = expenses.shared_expense_id)
          )`,
      new Date().toISOString(),
      ...syncedExpenseIds,
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
