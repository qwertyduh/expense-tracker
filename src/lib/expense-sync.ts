import { getExpense, getExpenseParticipants } from '@/db/expenses';
import { db } from '@/db/schema';
import {
  cancelOutbox,
  enqueueSharedExpense,
  enqueueSharedExpenseUpdate,
  enqueueSharedExpenseVoid,
  flushOutbox,
} from '@/lib/sync';

/**
 * After the edit screen writes an expense, decide whether its shared copy must
 * be created, updated, or voided.
 *
 * Local-only participants do not sync. As soon as at least one linked friend is
 * present, the expense becomes a shared expense owned by this user.
 */
export function syncExpenseAfterEdit(expenseId: string): void {
  const expense = getExpense(expenseId);
  if (!expense) return;

  const linked = getExpenseParticipants(expenseId).filter(
    (participant) => participant.remoteUserId && participant.username
  );

  if (linked.length === 0) {
    if (expense.shared_expense_id) {
      // Keep shared_expense_id until the server confirms the void (sync.ts
      // clears it then). If the void is rejected (expense_locked because a
      // friend already paid), the row must still know it is shared.
      enqueueSharedExpenseVoid(expense.shared_expense_id);
      db.runSync(
        `UPDATE expenses
            SET sync_status = 'pending', split_pending = 0, updated_at = ?
          WHERE id = ?`,
        new Date().toISOString(),
        expenseId
      );
      flushOutbox().catch(() => {});
    } else if (expense.split_pending !== 1) {
      db.runSync(
        'UPDATE expenses SET split_pending = 0, updated_at = ? WHERE id = ?',
        new Date().toISOString(),
        expenseId
      );
    }
    return;
  }

  const sharedId = expense.shared_expense_id ?? expense.id;
  // A friend was added back before a queued void was sent (or after it was
  // rejected): the void no longer reflects the user's intent.
  cancelOutbox('shared_expense', sharedId, 'void');
  db.runSync(
    `UPDATE expenses
        SET shared_expense_id = ?, sync_status = 'pending', split_pending = 0,
            updated_at = ?
      WHERE id = ?`,
    sharedId,
    new Date().toISOString(),
    expenseId
  );

  const payload = {
    id: sharedId,
    totalAmount: expense.total_amount,
    ownerShare: getExpense(expenseId)?.amount ?? expense.amount,
    label: expense.label,
    occurredAt: expense.occurred_at,
    participants: linked.map((participant) => ({
      username: participant.username!,
      displayName: participant.personName,
      shareAmount: participant.shareAmount,
    })),
  };

  if (expense.shared_expense_id == null) {
    enqueueSharedExpense(payload);
  } else {
    enqueueSharedExpenseUpdate(payload);
  }

  flushOutbox().catch(() => {});
}
