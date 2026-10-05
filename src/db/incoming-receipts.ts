import { randomUUID } from 'expo-crypto';

import { db } from './schema';

export interface IncomingReceiptRow {
  id: string;
  raw_sms_text: string;
  bank_source: string | null;
  parsed_amount: number | null;
  parsed_name: string | null;
  status: 'pending' | 'linked' | 'dismissed';
  received_at: string;
  created_at: string;
  updated_at: string;
}

// Caches a credit SMS captured while the phone was locked. The raw text is
// stored verbatim so nothing is lost before the user reviews it; the parsed
// fields are just hints and may be null.
export function insertIncomingReceipt(input: {
  rawSmsText: string;
  bankSource: string | null;
  parsedAmount: number | null;
  parsedName: string | null;
  receivedAt: string;
}): IncomingReceiptRow {
  const now = new Date().toISOString();
  const id = randomUUID();
  db.runSync(
    `INSERT INTO incoming_receipts
       (id, raw_sms_text, bank_source, parsed_amount, parsed_name, status,
        received_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
    id,
    input.rawSmsText,
    input.bankSource,
    input.parsedAmount,
    input.parsedName,
    input.receivedAt,
    now,
    now
  );
  return {
    id,
    raw_sms_text: input.rawSmsText,
    bank_source: input.bankSource,
    parsed_amount: input.parsedAmount,
    parsed_name: input.parsedName,
    status: 'pending',
    received_at: input.receivedAt,
    created_at: now,
    updated_at: now,
  };
}

export function listPendingIncomingReceipts(): IncomingReceiptRow[] {
  return db.getAllSync<IncomingReceiptRow>(
    `SELECT * FROM incoming_receipts WHERE status = 'pending'
     ORDER BY received_at DESC, created_at DESC`
  );
}

export function getIncomingReceipt(id: string): IncomingReceiptRow | null {
  return db.getFirstSync<IncomingReceiptRow>('SELECT * FROM incoming_receipts WHERE id = ?', id) ?? null;
}

export function markIncomingReceipt(id: string, status: 'linked' | 'dismissed'): void {
  const now = new Date().toISOString();
  db.runSync('UPDATE incoming_receipts SET status = ?, updated_at = ? WHERE id = ?', status, now, id);
}

export function countPendingIncomingReceipts(): number {
  return (
    db.getFirstSync<{ count: number }>(
      "SELECT COUNT(*) AS count FROM incoming_receipts WHERE status = 'pending'"
    )?.count ?? 0
  );
}
