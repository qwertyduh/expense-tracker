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
