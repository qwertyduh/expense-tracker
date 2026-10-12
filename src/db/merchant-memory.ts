import { CategoryRow } from './categories';
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

// Vendors arrive as free text from an SMS, so the same payee can show up with
// different casing or runs of whitespace between messages ("Vending Machine" vs
// "VENDING  MACHINE"). Match and de-dupe on this canonical form while keeping
// the first-seen spelling for display in Settings.
function normalizeMerchant(merchant: string): string {
  return merchant.trim().replace(/\s+/g, ' ').toLowerCase();
}

// Look up what a payee was filed under last time. Returns the full category row
// (not just its id) so the Add flow can select it without a second read. A row
// whose category has since been deleted fails safe to null — no skip, ask again.
export function getMerchantMemory(
  merchant: string
): { category: CategoryRow; splitCount: number } | null {
  const key = normalizeMerchant(merchant);
  if (!key) return null;

  // The table holds only learned payees (tiny), so scan-and-normalize in JS
  // rather than fight SQLite over whitespace collapsing. This also lets rows
  // written by the Android capture service match despite case differences.
  const rows = db.getAllSync<CategoryRow & { split_count: number; merchant: string }>(
    `SELECT c.*, m.merchant, m.split_count
     FROM merchant_memory m
     JOIN categories c ON c.id = m.category_id`
  );
  const row = rows.find((r) => normalizeMerchant(r.merchant) === key);
  if (!row) return null;

  const { split_count, merchant: _merchant, ...category } = row;
  return { category, splitCount: split_count };
}

// Learn (or update) a payee -> category mapping so a repeat payment can skip the
// category slide next time. An existing row for the same vendor is updated in
// place, so manually re-picking a category for a learned vendor overwrites the
// stored choice instead of creating a near-duplicate row. Keyed on the raw payee
// to stay compatible with rows written by the Android capture service.
export function rememberMerchant(merchant: string, categoryId: string, splitCount = 1): void {
  const key = merchant.trim();
  if (!key || !categoryId) return;

  const normalized = normalizeMerchant(key);
  const now = new Date().toISOString();
  const split = Math.max(1, Math.floor(splitCount));

  db.withTransactionSync(() => {
    const existing = db
      .getAllSync<{ merchant: string }>('SELECT merchant FROM merchant_memory')
      .find((r) => normalizeMerchant(r.merchant) === normalized);

    if (existing) {
      db.runSync(
        `UPDATE merchant_memory
         SET category_id = ?, split_count = ?, updated_at = ?
         WHERE merchant = ?`,
        categoryId,
        split,
        now,
        existing.merchant
      );
      return;
    }

    db.runSync(
      `INSERT INTO merchant_memory (merchant, category_id, split_count, updated_at)
       VALUES (?, ?, ?, ?)`,
      key,
      categoryId,
      split,
      now
    );
  });
}

export function clearMerchantMemory(): void {
  db.runSync('DELETE FROM merchant_memory');
}
