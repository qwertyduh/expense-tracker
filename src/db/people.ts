import { randomUUID } from 'expo-crypto';

import { getPersonByHandle, rememberHandle } from './person-handles';
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
// The display name is also learned as a handle, so a later payment from a
// differently formatted spelling can still find them.
export function addPerson(displayName: string): PersonRow {
  const name = displayName.trim();
  const now = new Date().toISOString();
  const id = randomUUID();
  db.runSync(
    'INSERT INTO people (id, display_name, is_self, created_at, updated_at) VALUES (?, ?, 0, ?, ?)',
    id,
    name,
    now,
    now
  );
  rememberHandle(name, id, 'name');
  return { id, display_name: name, is_self: 0, created_at: now, updated_at: now };
}

export function getPerson(id: string): PersonRow | null {
  return db.getFirstSync<PersonRow>('SELECT * FROM people WHERE id = ?', id) ?? null;
}

// Case-insensitive find-or-create by display name (trimmed). Used when capturing
// named split participants and when recording a repayment from someone.
//
// Resolution order: a known handle (a name spelling or UPI id already learned
// for a non-self person) → an exact display-name match → a new person. So
// "ANUSHKA GUPTA" lands on the same person as a previously saved "Anushka
// Gupta" once that spelling has been learned, instead of forking a duplicate.
export function findOrCreatePerson(displayName: string): PersonRow {
  const name = displayName.trim();
  if (!name) throw new Error('Person name is required');

  const handled = getPersonByHandle(name);
  if (handled) return handled;

  const existing = db.getFirstSync<PersonRow>(
    'SELECT * FROM people WHERE is_self = 0 AND lower(display_name) = lower(?) LIMIT 1',
    name
  );
  if (existing) {
    rememberHandle(name, existing.id, 'name');
    return existing;
  }

  return addPerson(name);
}

// Renames a non-self person and learns the new spelling as a handle. The old
// name stays as a handle too, so an earlier spelling still resolves to them.
export function renamePerson(id: string, displayName: string): void {
  const name = displayName.trim();
  if (!name) return;
  const now = new Date().toISOString();
  db.runSync(
    'UPDATE people SET display_name = ?, updated_at = ? WHERE id = ? AND is_self = 0',
    name,
    now,
    id
  );
  rememberHandle(name, id, 'name');
}

export function getSelf(): PersonRow | null {
  return db.getFirstSync<PersonRow>('SELECT * FROM people WHERE is_self = 1 LIMIT 1') ?? null;
}

export function updateSelfName(name: string): void {
  const now = new Date().toISOString();
  db.runSync(
    'UPDATE people SET display_name = ?, updated_at = ? WHERE is_self = 1',
    name.trim(),
    now
  );
}

