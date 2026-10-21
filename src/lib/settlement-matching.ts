import { listSharedDebtRows } from '@/db/shared-debts';
import {
  rankSettlementMatches,
  type SettlementMatch,
} from '@/lib/settlement-ranking';

export type { SettlementMatch };
export { rankSettlementMatches };

export function findSettlementMatches(input: {
  amount: number;
  direction: 'incoming' | 'outgoing';
  counterpartyHint?: string | null;
}): SettlementMatch[] {
  return rankSettlementMatches(listSharedDebtRows(), input);
}
