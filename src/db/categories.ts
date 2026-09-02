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
