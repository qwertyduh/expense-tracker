import { forgetHandle, normalizeHandle, rememberHandle } from './person-handles';
import { db } from './schema';

// Thin view over person_handles, restricted to kind='upi'. Kept because the
// receive flow talks about "the sender's UPI id" specifically; names are learned
// through person-handles directly.

export interface UpiAliasRow {
  upi_id: string;
  person_id: string;
  person_name: string | null;
  updated_at: string;
}

export function getUpiAlias(upiId: string): UpiAliasRow | null {
  const key = normalizeHandle(upiId);
  if (!key) return null;
  return (
    db.getFirstSync<UpiAliasRow>(
      `SELECT h.label AS upi_id, h.person_id, p.display_name AS person_name, h.updated_at
       FROM person_handles h
       JOIN people p ON p.id = h.person_id
       WHERE h.handle_key = ? AND h.kind = 'upi' LIMIT 1`,
      key
    ) ?? null
  );
}

export function getPersonIdForUpi(upiId: string): string | null {
  const key = normalizeHandle(upiId);
  if (!key) return null;
  return (
    db.getFirstSync<{ person_id: string }>(
      `SELECT person_id FROM person_handles
       WHERE handle_key = ? AND kind = 'upi' LIMIT 1`,
      key
    )?.person_id ?? null
  );
}

// Remembers (or updates) which person a UPI id belongs to.
export function rememberUpiAlias(upiId: string, personId: string): void {
  rememberHandle(upiId, personId, 'upi');
}

export function forgetUpiAlias(upiId: string): void {
  forgetHandle(upiId);
}

export function listUpiAliases(): UpiAliasRow[] {
  return db.getAllSync<UpiAliasRow>(
    `SELECT h.label AS upi_id, h.person_id, p.display_name AS person_name, h.updated_at
     FROM person_handles h
     JOIN people p ON p.id = h.person_id
     WHERE h.kind = 'upi'
     ORDER BY h.updated_at DESC`
  );
}
