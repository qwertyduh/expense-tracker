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

function nameMatches(hint: string | null, row: SharedDebtRow): boolean {
  if (!hint) return false;
  const normalized = hint.trim().toLowerCase();
  if (!normalized) return false;
  return (
    row.counterpartyUsername.toLowerCase() === normalized ||
    row.counterpartyDisplayName.toLowerCase() === normalized ||
    row.counterpartyDisplayName.toLowerCase().includes(normalized) ||
    normalized.includes(row.counterpartyDisplayName.toLowerCase())
  );
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
      return Math.abs(input.amount - a.remaining) - Math.abs(input.amount - b.remaining);
    });
}
