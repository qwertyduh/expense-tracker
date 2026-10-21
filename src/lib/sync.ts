import { randomUUID } from 'expo-crypto';

import type { SharedExpenseDraft } from '@/db/expenses';
import { db } from '@/db/schema';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

type OutboxRow = {
  id: string;
  entity_type: string;
  entity_id: string;
  operation: string;
  payload: string;
  attempts: number;
};

const MAX_BACKOFF_MS = 5 * 60 * 1000;

function nowIso(): string {
  return new Date().toISOString();
}

type SharedExpensePayload = {
  id: string;
  totalAmount: number;
  ownerShare: number;
  label: string | null;
  occurredAt: string;
  participants: { username: string; shareAmount: number }[];
};

function enqueue(
  entityType: string,
  entityId: string,
  operation: string,
  payload: unknown
): void {
  const now = nowIso();
  db.runSync(
    `INSERT OR REPLACE INTO sync_outbox
       (id, entity_type, entity_id, operation, payload, attempts,
        next_attempt_at, last_error, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 0, NULL, NULL, ?, ?)`,
    randomUUID(),
    entityType,
    entityId,
    operation,
    JSON.stringify(payload),
    now,
    now
  );
}

export function enqueueSharedExpenseUpdate(draft: SharedExpensePayload): void {
  enqueue('shared_expense', draft.id, 'update', {
    id: draft.id,
    total_amount: draft.totalAmount,
    owner_share: draft.ownerShare,
    label: draft.label,
    occurred_at: draft.occurredAt,
    participants: draft.participants.map((participant) => ({
      username: participant.username,
      share_amount: participant.shareAmount,
    })),
  });
}

export function enqueueSharedExpenseVoid(expenseId: string): void {
  enqueue('shared_expense', expenseId, 'void', { id: expenseId });
}

export function enqueueSharedExpense(draft: SharedExpenseDraft): void {
  enqueue('shared_expense', draft.id, 'create', {
    id: draft.id,
    total_amount: draft.totalAmount,
    owner_share: draft.ownerShare,
    label: draft.label,
    occurred_at: draft.occurredAt,
    participants: draft.participants.map((participant) => ({
      username: participant.username,
      share_amount: participant.shareAmount,
    })),
  });
}

function dueRows(): OutboxRow[] {
  return db.getAllSync<OutboxRow>(
    `SELECT id, entity_type, entity_id, operation, payload, attempts
       FROM sync_outbox
      WHERE next_attempt_at IS NULL OR next_attempt_at <= ?
      ORDER BY created_at ASC
      LIMIT 20`,
    nowIso()
  );
}

function removeRow(id: string): void {
  db.runSync('DELETE FROM sync_outbox WHERE id = ?', id);
}

function failRow(row: OutboxRow, error: string): void {
  const attempts = row.attempts + 1;
  const delay = Math.min(MAX_BACKOFF_MS, 2 ** attempts * 1000);
  db.runSync(
    `UPDATE sync_outbox
        SET attempts = ?, last_error = ?, next_attempt_at = ?, updated_at = ?
      WHERE id = ?`,
    attempts,
    error.slice(0, 500),
    new Date(Date.now() + delay).toISOString(),
    nowIso(),
    row.id
  );
}

let flushing = false;

export async function flushOutbox(): Promise<void> {
  if (!isSupabaseConfigured || flushing) return;
  flushing = true;
  try {
    for (const row of dueRows()) {
      try {
        if (row.entity_type === 'shared_expense' && row.operation === 'create') {
          const { error } = await supabase.rpc('create_shared_expense', {
            p_payload: JSON.parse(row.payload),
          });
          if (error) throw error;
          supabase.functions
            .invoke('notify-debt', {
              body: { expenseId: row.entity_id, kind: 'created' },
            })
            .catch(() => {});
          db.runSync(
            "UPDATE expenses SET sync_status = 'synced', updated_at = ? WHERE id = ?",
            nowIso(),
            row.entity_id
          );
          removeRow(row.id);
        } else if (row.entity_type === 'shared_expense' && row.operation === 'update') {
          const { error } = await supabase.rpc('update_shared_expense', {
            p_payload: JSON.parse(row.payload),
          });
          if (error) throw error;
          db.runSync(
            "UPDATE expenses SET sync_status = 'synced', updated_at = ? WHERE id = ? OR shared_expense_id = ?",
            nowIso(),
            row.entity_id,
            row.entity_id
          );
          removeRow(row.id);
        } else if (row.entity_type === 'shared_expense' && row.operation === 'void') {
          const { error } = await supabase.rpc('void_shared_expense', {
            p_expense_id: row.entity_id,
          });
          if (error) throw error;
          removeRow(row.id);
        } else {
          // Unknown operations stay queued for a future app version.
          throw new Error(`Unsupported outbox operation: ${row.entity_type}/${row.operation}`);
        }
      } catch (err) {
        failRow(row, err instanceof Error ? err.message : String(err));
      }
    }
  } finally {
    flushing = false;
  }
}
