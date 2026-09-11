import { randomUUID } from 'expo-crypto';

import { db } from './schema';

// The expense row's `amount` is YOUR share. total_amount is the full bill.
// Splits are a count + your share: this is a local single-user app, so the
// other people are never tracked as named participants — they just cover the
// difference between the bill and your share.
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

    db.runSync(
      `INSERT INTO activity_log
         (id, action, expense_id, expense_snapshot, occurred_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      randomUUID(),
      'created',
      expenseId,
      JSON.stringify(snapshot),
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

