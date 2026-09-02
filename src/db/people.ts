import { randomUUID } from 'expo-crypto';

import { db } from './schema';

export interface PersonRow {
  id: string;
  display_name: string;
  is_self: number;
  created_at: string;
  updated_at: string;
}

export function listPeople(): PersonRow[] {
  return db.getAllSync<PersonRow>(
    'SELECT * FROM people ORDER BY is_self DESC, display_name ASC'
  );
}

// Creates a non-self person (e.g. split participant) and returns the new row.
export function addPerson(displayName: string): PersonRow {
  const now = new Date().toISOString();
  const id = randomUUID();
  db.runSync(
    'INSERT INTO people (id, display_name, is_self, created_at, updated_at) VALUES (?, ?, 0, ?, ?)',
    id,
    displayName,
    now,
    now
  );
  return { id, display_name: displayName, is_self: 0, created_at: now, updated_at: now };
}
