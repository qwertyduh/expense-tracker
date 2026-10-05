import { randomUUID } from 'expo-crypto';

import { findOrCreatePerson } from './people';
import { db } from './schema';

// The expense row's `amount` is YOUR share. total_amount is the full bill.
// A split is your share plus named participants, each carrying the portion they
// owe. Those shares are what incoming repayments get matched against.
export type InsertExpenseInput = {
  totalAmount: number;
  /** Your portion of the bill — stored as expenses.amount. */
  selfShare: number;
  categoryId: string;
  label: string | null;
  merchant: string | null;
  source: 'manual' | 'sms';
  bankSource: string | null;
  rawSmsText: string | null;
  occurredAt: string; // ISO — actual transaction time
  /** Named split participants and the share each owes; omitted when unsplit. */
  participants?: { name: string; shareAmount: number }[];
};

export type InsertExpenseResult = {
  expenseId: string;
  amount: number; // your share
  isSplit: boolean;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Atomically writes one completed expense: the expenses row and an
// append-only activity_log 'created' row carrying a full JSON snapshot —
// all-or-nothing inside a single transaction.
export function insertExpense(input: InsertExpenseInput): InsertExpenseResult {
  const expenseId = randomUUID();
  const now = new Date().toISOString();
  const amount = round2(Math.max(0, Math.min(input.selfShare, input.totalAmount)));
  const isSplit = amount < round2(input.totalAmount);

  const snapshot = {
    id: expenseId,
    total_amount: round2(input.totalAmount),
    amount,
    currency: 'INR',
    category_id: input.categoryId,
    label: input.label,
    merchant: input.merchant,
    source: input.source,
    bank_source: input.bankSource,
    raw_sms_text: input.rawSmsText,
    is_split: isSplit ? 1 : 0,
    occurred_at: input.occurredAt,
    created_at: now,
    updated_at: now,
  };

  db.withTransactionSync(() => {
    db.runSync(
      `INSERT INTO expenses
         (id, amount, total_amount, currency, category_id, label, merchant,
          source, bank_source, raw_sms_text, is_split, occurred_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      expenseId,
      amount,
      round2(input.totalAmount),
      'INR',
      input.categoryId,
      input.label,
      input.merchant,
      input.source,
      input.bankSource,
      input.rawSmsText,
      isSplit ? 1 : 0,
      input.occurredAt,
      now,
      now
    );

    // Resolve named participants (find-or-create) so the snapshot can carry
    // their stable person ids alongside the display names.
    const participantSnapshot = (input.participants ?? []).map((participant) => {
      const person = findOrCreatePerson(participant.name);
      const shareAmount = round2(participant.shareAmount);
      db.runSync(
        `INSERT INTO expense_participants
           (id, expense_id, person_id, share_amount, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        randomUUID(),
        expenseId,
        person.id,
        shareAmount,
        now,
        now
      );
      return {
        person_id: person.id,
        display_name: person.display_name,
        share_amount: shareAmount,
      };
    });

    db.runSync(
      `INSERT INTO activity_log
         (id, action, expense_id, expense_snapshot, occurred_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      randomUUID(),
      'created',
      expenseId,
      JSON.stringify({ ...snapshot, participants: participantSnapshot }),
      now,
      now
    );
  });

  return { expenseId, amount, isSplit };
}

export interface ExpenseRow {
  id: string;
  amount: number;
  total_amount: number;
  currency: string;
  category_id: string;
  category_name: string | null;
  label: string | null;
  merchant: string | null;
  source: string;
  bank_source: string | null;
  raw_sms_text: string | null;
  is_split: number;
  occurred_at: string;
  created_at: string;
  updated_at: string;
}

const EXPENSE_SELECT = `
  SELECT e.*, c.name AS category_name
  FROM expenses e
  LEFT JOIN categories c ON c.id = e.category_id
`;

export function listExpenses(limit = 100): ExpenseRow[] {
  return db.getAllSync<ExpenseRow>(
    `${EXPENSE_SELECT} ORDER BY e.occurred_at DESC, e.created_at DESC LIMIT ?`,
    limit
  );
}

export function getExpense(id: string): ExpenseRow | null {
  return db.getFirstSync<ExpenseRow>(`${EXPENSE_SELECT} WHERE e.id = ?`, id) ?? null;
}

export type UpdateExpenseInput = {
  categoryId: string;
  totalAmount: number;
  selfShare: number;
  label: string | null;
  merchant: string | null;
  occurredAt: string;
};

// Updates the row and appends an activity_log 'edited' snapshot atomically.
export function updateExpense(id: string, input: UpdateExpenseInput): void {
  const existing = getExpense(id);
  if (!existing) return;
  const now = new Date().toISOString();
  const amount = round2(Math.max(0, Math.min(input.selfShare, input.totalAmount)));
  const isSplit = amount < round2(input.totalAmount);

  const snapshot = {
    id,
    total_amount: round2(input.totalAmount),
    amount,
    currency: existing.currency,
    category_id: input.categoryId,
    label: input.label,
    merchant: input.merchant,
    source: existing.source,
    bank_source: existing.bank_source,
    raw_sms_text: existing.raw_sms_text,
    is_split: isSplit ? 1 : 0,
    occurred_at: input.occurredAt,
    created_at: existing.created_at,
    updated_at: now,
  };

  db.withTransactionSync(() => {
    db.runSync(
      `UPDATE expenses SET amount = ?, total_amount = ?, category_id = ?, label = ?,
         merchant = ?, is_split = ?, occurred_at = ?, updated_at = ? WHERE id = ?`,
      amount,
      round2(input.totalAmount),
      input.categoryId,
      input.label,
      input.merchant,
      isSplit ? 1 : 0,
      input.occurredAt,
      now,
      id
    );
    db.runSync(
      `INSERT INTO activity_log (id, action, expense_id, expense_snapshot, occurred_at, created_at)
       VALUES (?, 'edited', ?, ?, ?, ?)`,
      randomUUID(),
      id,
      JSON.stringify(snapshot),
      now,
      now
    );
  });
}

// Deletes the row and appends an activity_log 'deleted' snapshot (history
// survives deletion because activity_log has no FK to expenses).
export function deleteExpense(id: string): void {
  const existing = getExpense(id);
  if (!existing) return;
  const now = new Date().toISOString();
  db.withTransactionSync(() => {
    db.runSync('DELETE FROM expenses WHERE id = ?', id);
    db.runSync(
      `INSERT INTO activity_log (id, action, expense_id, expense_snapshot, occurred_at, created_at)
       VALUES (?, 'deleted', ?, ?, ?, ?)`,
      randomUUID(),
      id,
      JSON.stringify(existing),
      now,
      now
    );
  });
}

export type ParticipantWithBalance = {
  personId: string;
  personName: string;
  shareAmount: number;
  receivedAmount: number; // sum of settlement_allocations for this expense+person
  remaining: number; // shareAmount - receivedAmount
};

// Named participants on one expense, each with how much of their share has been
// received. received_amount is aggregated from the settlements ledger, so this
// stays correct no matter how many repayments land on the share.
export function getExpenseParticipants(expenseId: string): ParticipantWithBalance[] {
  const rows = db.getAllSync<{
    person_id: string;
    display_name: string;
    share_amount: number;
    received_amount: number;
  }>(
    `SELECT ep.person_id, p.display_name, ep.share_amount,
            COALESCE(sa.received, 0) AS received_amount
     FROM expense_participants ep
     JOIN people p ON p.id = ep.person_id
     LEFT JOIN (
       SELECT expense_id, person_id, SUM(amount) AS received
       FROM settlement_allocations
       GROUP BY expense_id, person_id
     ) sa ON sa.expense_id = ep.expense_id AND sa.person_id = ep.person_id
     WHERE ep.expense_id = ?
     ORDER BY ep.created_at ASC`,
    expenseId
  );

  return rows.map((row) => {
    const shareAmount = round2(row.share_amount);
    const receivedAmount = round2(row.received_amount);
    return {
      personId: row.person_id,
      personName: row.display_name,
      shareAmount,
      receivedAmount,
      remaining: round2(shareAmount - receivedAmount),
    };
  });
}

// Replace the split of an existing expense: sets selfShare and the named
// participant shares. Used by the "resplit evenly" action and the expense edit
// screen. Transactional; keeps existing settlement_allocations untouched.
export function setExpenseSplit(
  expenseId: string,
  selfShare: number,
  participants: { name: string; shareAmount: number }[]
): void {
  const existing = getExpense(expenseId);
  if (!existing) return;
  const now = new Date().toISOString();
  const amount = round2(Math.max(0, Math.min(selfShare, existing.total_amount)));
  const isSplit = amount < round2(existing.total_amount);

  db.withTransactionSync(() => {
    db.runSync(
      `UPDATE expenses SET amount = ?, is_split = ?, updated_at = ? WHERE id = ?`,
      amount,
      isSplit ? 1 : 0,
      now,
      expenseId
    );
    // Rebuild the participant set; allocations key off (expense_id, person_id)
    // so they survive this delete/re-insert and keep counting against the share.
    db.runSync('DELETE FROM expense_participants WHERE expense_id = ?', expenseId);
    for (const participant of participants) {
      const person = findOrCreatePerson(participant.name);
      db.runSync(
        `INSERT INTO expense_participants
           (id, expense_id, person_id, share_amount, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        randomUUID(),
        expenseId,
        person.id,
        round2(participant.shareAmount),
        now,
        now
      );
    }
  });
}

