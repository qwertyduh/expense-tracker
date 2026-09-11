import { randomUUID } from 'expo-crypto';

import { db } from './schema';

export interface CategoryRow {
  id: string;
  name: string;
  sort_order: number;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
}

// Recent-first ordering. "last_used_at IS NULL" sorts non-null (used) ahead of
// null (never used), so used categories surface by recency. Never-used ones
// still fill out the five chips in sort_order (defaults on first launch),
// which ORDER BY last_used_at ... LIMIT 5 alone would never return.
export function listRecentCategories(limit = 5): CategoryRow[] {
  const rows = db.getAllSync<CategoryRow>(
    `SELECT * FROM categories
     ORDER BY last_used_at IS NULL ASC, last_used_at DESC, sort_order ASC`
  );
  return rows.slice(0, limit);
}

// The "more" full list — stable manual ranking, unaffected by usage.
export function listAllCategories(): CategoryRow[] {
  return db.getAllSync<CategoryRow>(
    'SELECT * FROM categories ORDER BY sort_order ASC, name ASC'
  );
}

// Called the moment a category is picked (not on final confirm) so the
// quick-pick chips re-order live, per blueprint §3.
export function touchCategory(id: string): void {
  const now = new Date().toISOString();
  db.runSync('UPDATE categories SET last_used_at = ?, updated_at = ? WHERE id = ?', now, now, id);
}

export function addCategory(name: string): CategoryRow {
  const now = new Date().toISOString();
  const id = randomUUID();
  const sortOrder = db.getFirstSync<{ next: number }>(
    'SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM categories'
  )?.next ?? 1;
  db.runSync(
    'INSERT INTO categories (id, name, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    id,
    name.trim(),
    sortOrder,
    now,
    now
  );
  return {
    id,
    name: name.trim(),
    sort_order: sortOrder,
    last_used_at: null,
    created_at: now,
    updated_at: now,
  };
}

export function renameCategory(id: string, name: string): void {
  const now = new Date().toISOString();
  db.runSync('UPDATE categories SET name = ?, updated_at = ? WHERE id = ?', name.trim(), now, id);
}

// Persists a full manual ranking; index in the array becomes sort_order.
export function reorderCategories(orderedIds: string[]): void {
  const now = new Date().toISOString();
  db.withTransactionSync(() => {
    orderedIds.forEach((id, index) => {
      db.runSync('UPDATE categories SET sort_order = ?, updated_at = ? WHERE id = ?', index, now, id);
    });
  });
}

export function deleteCategory(id: string): void {
  db.runSync('DELETE FROM categories WHERE id = ?', id);
}

export function countExpensesForCategory(id: string): number {
  return (
    db.getFirstSync<{ count: number }>(
      'SELECT COUNT(*) AS count FROM expenses WHERE category_id = ?',
      id
    )?.count ?? 0
  );
}

