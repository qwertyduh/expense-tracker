import { db } from './schema';

export interface MerchantMemoryRow {
  merchant: string;
  category_id: string;
  category_name: string | null;
  split_count: number;
  updated_at: string;
}

// Written by the Android capture service; surfaced here so the Settings screen
// can show and forget learned payee -> category mappings.
export function listMerchantMemory(): MerchantMemoryRow[] {
  return db.getAllSync<MerchantMemoryRow>(
    `SELECT m.merchant, m.category_id, c.name AS category_name, m.split_count, m.updated_at
     FROM merchant_memory m
     LEFT JOIN categories c ON c.id = m.category_id
     ORDER BY m.updated_at DESC`
  );
}

export function forgetMerchant(merchant: string): void {
  db.runSync('DELETE FROM merchant_memory WHERE merchant = ?', merchant);
}
