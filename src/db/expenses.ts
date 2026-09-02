import { randomUUID } from 'expo-crypto';

import { db } from './schema';

// Mirrors schema comment on expenses.amount: the expense row's `amount` is
// YOUR share. totalAmount is the full bill. Slides feed totalAmount + the
// split participants; self's share is derived here.
export type ExpenseParticipantInput = {
  /** 'self' for you (resolved to the real is_self person row), else people.id. */
  personId: string;
  displayName: string;
  shareAmount: number;
};

export type InsertExpenseInput = {
  totalAmount: number;
  categoryId: string;
  label: string | null;
  merchant: string | null;
  source: 'manual' | 'sms';
  bankSource: string | null;
  rawSmsText: string | null;
  occurredAt: string; // ISO — actual transaction time
  participants: ExpenseParticipantInput[];
};

export type InsertExpenseResult = {
  expenseId: string;
  amount: number; // your share
  isSplit: boolean;
};

const SELF_KEY = 'self';

// Atomically writes one completed expense: the expenses row, an
// expense_participants row per split member (only when split), and an
// append-only activity_log 'created' row carrying a full JSON snapshot —
// all-or-nothing inside a single transaction.
export function insertExpense(input: InsertExpenseInput): InsertExpenseResult {
  const expenseId = randomUUID();
  const now = new Date().toISOString();
  const isSplit = input.participants.length > 1;

  // Resolve the self person row (needed for the share + participants FK).
  const selfRow = db.getFirstSync<{ id: string }>(
    'SELECT id FROM people WHERE is_self = 1 LIMIT 1'
  );
  if (!selfRow) throw new Error('Cannot insert expense: no self person row exists');

  const selfShare =
    input.participants.find((p) => p.personId === SELF_KEY)?.shareAmount ?? input.totalAmount;

  // Resolve participant person ids ('self' -> real id) and keep display names
  // for the snapshot.
  const resolvedParticipants = input.participants.map((p) => ({
    personId: p.personId === SELF_KEY ? selfRow.id : p.personId,
    displayName: p.displayName,
    shareAmount: p.shareAmount,
  }));

  const snapshot = {
    id: expenseId,
    total_amount: input.totalAmount,
    amount: selfShare,
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
    participants: resolvedParticipants.map((p) => ({
      person_id: p.personId,
      display_name: p.displayName,
      share_amount: p.shareAmount,
    })),
  };

  db.withTransactionSync(() => {
    db.runSync(
      `INSERT INTO expenses
         (id, amount, total_amount, currency, category_id, label, merchant,
          source, bank_source, raw_sms_text, is_split, occurred_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      expenseId,
      selfShare,
      input.totalAmount,
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

    if (isSplit) {
      for (const p of resolvedParticipants) {
        db.runSync(
          `INSERT INTO expense_participants
             (id, expense_id, person_id, share_amount, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          randomUUID(),
          expenseId,
          p.personId,
          p.shareAmount,
          now,
          now
        );
      }
    }

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

  return { expenseId, amount: selfShare, isSplit };
}
