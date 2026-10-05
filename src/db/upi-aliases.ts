import { db } from './schema';

export interface UpiAliasRow {
  upi_id: string;
  person_id: string;
  person_name: string | null;
  updated_at: string;
}

// UPI ids are case-insensitive, so every read and write normalizes to lowercase
// (otherwise "Anushka@okhdfc" and "anushka@okhdfc" would become two rows).
function normalize(upiId: string): string {
  return upiId.trim().toLowerCase();
}

export function getUpiAlias(upiId: string): UpiAliasRow | null {
  const id = normalize(upiId);
  if (!id) return null;
  return (
    db.getFirstSync<UpiAliasRow>(
      `SELECT a.upi_id, a.person_id, p.display_name AS person_name, a.updated_at
       FROM upi_aliases a
       LEFT JOIN people p ON p.id = a.person_id
       WHERE a.upi_id = ? LIMIT 1`,
      id
    ) ?? null
  );
}

export function getPersonIdForUpi(upiId: string): string | null {
  const id = normalize(upiId);
  if (!id) return null;
  return (
    db.getFirstSync<{ person_id: string }>(
      'SELECT person_id FROM upi_aliases WHERE upi_id = ? LIMIT 1',
      id
    )?.person_id ?? null
  );
}

// Remembers (or updates) which person a UPI id belongs to.
export function rememberUpiAlias(upiId: string, personId: string): void {
  const id = normalize(upiId);
  if (!id || !personId) return;
  const now = new Date().toISOString();
  db.runSync(
    `INSERT INTO upi_aliases (upi_id, person_id, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(upi_id) DO UPDATE SET person_id = excluded.person_id, updated_at = excluded.updated_at`,
    id,
    personId,
    now
  );
}

export function forgetUpiAlias(upiId: string): void {
  db.runSync('DELETE FROM upi_aliases WHERE upi_id = ?', normalize(upiId));
}

export function listUpiAliases(): UpiAliasRow[] {
  return db.getAllSync<UpiAliasRow>(
    `SELECT a.upi_id, a.person_id, p.display_name AS person_name, a.updated_at
     FROM upi_aliases a
     LEFT JOIN people p ON p.id = a.person_id
     ORDER BY a.updated_at DESC`
  );
}
