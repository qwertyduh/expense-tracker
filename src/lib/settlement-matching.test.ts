import { describe, expect, it } from 'vitest';

import type { SharedDebtRow } from '@/db/shared-debts';
import { rankSettlementMatches } from './settlement-ranking';

function row(overrides: Partial<SharedDebtRow>): SharedDebtRow {
  return {
    participantId: 'p1',
    expenseId: 'e1',
    direction: 'they_owe_me',
    counterpartyUserId: 'u1',
    counterpartyUsername: 'bob1',
    counterpartyDisplayName: 'Bob',
    totalAmount: 100,
    label: 'Dinner',
    occurredAt: '2026-10-19T12:00:00Z',
    shareAmount: 30,
    settledAmount: 0,
    status: 'pending',
    updatedAt: '2026-10-19T12:00:00Z',
    ...overrides,
  };
}

describe('rankSettlementMatches', () => {
  it('matches incoming payments against money owed to me', () => {
    const rows = [
      row({ participantId: 'owed', direction: 'they_owe_me', shareAmount: 30 }),
      row({
        participantId: 'paid',
        direction: 'i_owe_them',
        shareAmount: 30,
        counterpartyUsername: 'alice1',
      }),
    ];
    const matches = rankSettlementMatches(rows, { amount: 30, direction: 'incoming' });
    expect(matches.map((match) => match.row.participantId)).toEqual(['owed']);
  });

  it('prefers an exact amount over a tolerant one', () => {
    const rows = [
      row({ participantId: 'tolerant', shareAmount: 30 }),
      row({ participantId: 'exact', shareAmount: 25 }),
    ];
    const matches = rankSettlementMatches(rows, { amount: 25, direction: 'incoming' });
    expect(matches[0].row.participantId).toBe('exact');
    expect(matches[0].exact).toBe(true);
  });

  it('accepts ₹1 tolerance for a full settlement', () => {
    const rows = [row({ shareAmount: 30 })];
    expect(rankSettlementMatches(rows, { amount: 29, direction: 'incoming' })).toHaveLength(1);
    expect(rankSettlementMatches(rows, { amount: 31, direction: 'incoming' })).toHaveLength(1);
    expect(rankSettlementMatches(rows, { amount: 28.99, direction: 'incoming' })).toHaveLength(0);
  });

  it('does not suggest partial payments', () => {
    const rows = [row({ shareAmount: 100 })];
    expect(rankSettlementMatches(rows, { amount: 20, direction: 'incoming' })).toHaveLength(0);
  });

  it('uses the counterparty name as a tie-breaker', () => {
    const rows = [
      row({ participantId: 'other', counterpartyUsername: 'carol1', counterpartyDisplayName: 'Carol' }),
      row({ participantId: 'bob', counterpartyUsername: 'bob1', counterpartyDisplayName: 'Bob' }),
    ];
    const matches = rankSettlementMatches(rows, {
      amount: 30,
      direction: 'incoming',
      counterpartyHint: 'bob1',
    });
    expect(matches[0].row.participantId).toBe('bob');
  });

  it('ignores paid, disputed, and settled rows', () => {
    const rows = [
      row({ participantId: 'paid', status: 'paid' }),
      row({ participantId: 'disputed', status: 'disputed' }),
      row({ participantId: 'settled', settledAmount: 30 }),
    ];
    expect(rankSettlementMatches(rows, { amount: 30, direction: 'incoming' })).toHaveLength(0);
  });
});
