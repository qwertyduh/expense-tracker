import { db } from './schema';
import type { PersonRow } from './people';

// A handle is any string that can identify a person on an incoming payment: a
// UPI id (VPA) or a name spelling. A person can have many.
export type HandleKind = 'name' | 'upi';

export interface PersonHandleRow {
  handle_key: string;
  person_id: string;
  kind: HandleKind;
  /** The handle as it was first seen/typed, for display. */
  label: string;
  created_at: string;
  updated_at: string;
}

// Handles match case-insensitively with runs of whitespace collapsed, so
// "Anushka  Gupta"/"anushka gupta" and "Anushka@okhdfc"/"anushka@okhdfc" each
// collapse to one key.
export function normalizeHandle(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

// The person a handle belongs to, or null when it is not known yet. Self is
// never matched — you cannot repay yourself.
export function getPersonByHandle(handle: string): PersonRow | null {
  const key = normalizeHandle(handle);
  if (!key) return null;
  return (
    db.getFirstSync<PersonRow>(
      `SELECT p.* FROM person_handles h
       JOIN people p ON p.id = h.person_id
       WHERE h.handle_key = ? AND p.is_self = 0 LIMIT 1`,
      key
    ) ?? null
  );
}

export function listHandlesForPerson(personId: string): PersonHandleRow[] {
  return db.getAllSync<PersonHandleRow>(
    `SELECT * FROM person_handles
     WHERE person_id = ?
     ORDER BY kind ASC, updated_at DESC`,
    personId
  );
}

export interface PersonWithHandles {
  person: PersonRow;
  handles: PersonHandleRow[];
}

// Every non-self person with the handles that resolve to them, for Settings.
export function listPeopleWithHandles(): PersonWithHandles[] {
  const people = db.getAllSync<PersonRow>(
    'SELECT * FROM people WHERE is_self = 0 ORDER BY display_name ASC'
  );
  const handles = db.getAllSync<PersonHandleRow>(
    'SELECT * FROM person_handles ORDER BY kind ASC, updated_at DESC'
  );

  const byPerson = new Map<string, PersonHandleRow[]>();
  for (const handle of handles) {
    const list = byPerson.get(handle.person_id);
    if (list) list.push(handle);
    else byPerson.set(handle.person_id, [handle]);
  }

  return people.map((person) => ({ person, handles: byPerson.get(person.id) ?? [] }));
}

// Learn (or re-point) a handle. Upsert keeps one row per normalized handle, so a
// renamed person can absorb a new spelling and a re-point updates in place.
export function rememberHandle(handle: string, personId: string, kind: HandleKind): void {
  const key = normalizeHandle(handle);
  if (!key || !personId) return;
  const now = new Date().toISOString();
  db.runSync(
    `INSERT INTO person_handles (handle_key, person_id, kind, label, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(handle_key) DO UPDATE SET
       person_id = excluded.person_id,
       kind = excluded.kind,
       label = excluded.label,
       updated_at = excluded.updated_at`,
    key,
    personId,
    kind,
    handle.trim(),
    now,
    now
  );
}

export function forgetHandle(handleKey: string): void {
  const key = normalizeHandle(handleKey);
  if (!key) return;
  db.runSync('DELETE FROM person_handles WHERE handle_key = ?', key);
}
