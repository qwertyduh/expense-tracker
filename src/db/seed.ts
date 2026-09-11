import { db } from './schema';
import { randomUUID } from 'expo-crypto'; // npx expo install expo-crypto

const DEFAULT_CATEGORIES = [
  'Petty Snacks',
  'Food',
  'Transport',
  'Groceries',
  'Utilities',
];

// Call once on first launch. Safe to call repeatedly — checks before inserting.
export function seedDatabase(selfName: string): void {
  const now = new Date().toISOString();

  const existingSelf = db.getFirstSync<{ id: string }>(
    'SELECT id FROM people WHERE is_self = 1 LIMIT 1'
  );
  if (!existingSelf) {
    db.runSync(
      'INSERT INTO people (id, display_name, is_self, created_at, updated_at) VALUES (?, ?, 1, ?, ?)',
      randomUUID(),
      selfName,
      now,
      now
    );
  }

  const existingCategoryCount = db.getFirstSync<{ count: number }>(
    'SELECT COUNT(*) as count FROM categories'
  );
  if (!existingCategoryCount || existingCategoryCount.count === 0) {
    DEFAULT_CATEGORIES.forEach((name, index) => {
      db.runSync(
        'INSERT INTO categories (id, name, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        randomUUID(),
        name,
        index,
        now,
        now
      );
    });
  }

  // Safety net for Android auto-capture: payments ignored on the overlay card
  // are filed here. High sort_order keeps it out of the quick-pick chips until
  // it is actually used. INSERT OR IGNORE relies on categories.name UNIQUE.
  db.runSync(
    'INSERT OR IGNORE INTO categories (id, name, sort_order, created_at, updated_at) VALUES (?, ?, 9999, ?, ?)',
    randomUUID(),
    'Unsorted',
    now,
    now
  );
}
