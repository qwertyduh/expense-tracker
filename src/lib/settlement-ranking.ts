import type { SharedDebtRow } from '@/db/shared-debts';

export type SettlementMatch = {
  row: SharedDebtRow;
  remaining: number;
  exact: boolean;
  withinTolerance: boolean;
  nameMatch: boolean;
};

function remainingOf(row: SharedDebtRow): number {
  return Math.round((row.shareAmount - row.settledAmount) * 100) / 100;
}

function words(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

// Whole-name or whole-word matches only. Arbitrary substring containment made
// "Al" match "Alice" and "Bob" match "bobby", floating the wrong person's debt
// to the top of a settlement prompt.
function nameMatches(hint: string | null, row: SharedDebtRow): boolean {
  if (!hint) return false;
  const normalized = hint.trim().toLowerCase();
  if (!normalized) return false;

  const username = row.counterpartyUsername.toLowerCase();
  const display = row.counterpartyDisplayName.trim().toLowerCase();
  if (username === normalized || display === normalized) return true;

  // Words shorter than 3 characters are too ambiguous to identify anyone.
  const hintWords = words(normalized).filter((word) => word.length >= 3);
  const nameWords = new Set([...words(display), username]);
  return hintWords.some((word) => nameWords.has(word));
}

/**
 * Finds shared debts that a detected payment could settle.
 *
 * Exact matches win. A payment within ₹1 of the full remaining balance is a
 * full-settlement candidate (the server records the difference as rounding).
 * Partial amounts must match exactly, so they are not suggested here.
 */
export function rankSettlementMatches(
  rows: SharedDebtRow[],
  input: {
    amount: number;
    direction: 'incoming' | 'outgoing';
    counterpartyHint?: string | null;
  }
): SettlementMatch[] {
  if (!(input.amount > 0)) return [];
  const wanted = input.direction === 'incoming' ? 'they_owe_me' : 'i_owe_them';

  return rows
    .filter((row) => row.status === 'pending' && row.direction === wanted)
    .map((row) => {
      const remaining = remainingOf(row);
      const diff = Math.abs(input.amount - remaining);
      return {
        row,
        remaining,
        exact: diff <= 0.01,
        withinTolerance: diff <= 1.0,
        nameMatch: nameMatches(input.counterpartyHint ?? null, row),
      };
    })
    .filter((match) => match.remaining > 0.005 && match.withinTolerance)
    .sort((a, b) => {
      if (a.exact !== b.exact) return a.exact ? -1 : 1;
      if (a.nameMatch !== b.nameMatch) return a.nameMatch ? -1 : 1;
      const byDistance =
        Math.abs(input.amount - a.remaining) - Math.abs(input.amount - b.remaining);
      if (byDistance !== 0) return byDistance;
      // Deterministic: oldest debt first, then id, independent of input order.
      if (a.row.occurredAt !== b.row.occurredAt) {
        return a.row.occurredAt < b.row.occurredAt ? -1 : 1;
      }
      return a.row.participantId < b.row.participantId ? -1 : 1;
    });
}
