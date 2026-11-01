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
    // 29.5 is within ₹1 of both 29.5 (exact) and 30 (tolerant), so ordering is
    // what decides the result, not filtering.
    const rows = [
      row({ participantId: 'tolerant', shareAmount: 30 }),
      row({ participantId: 'exact', shareAmount: 29.5 }),
    ];
    const matches = rankSettlementMatches(rows, { amount: 29.5, direction: 'incoming' });
    expect(matches.map((match) => match.row.participantId)).toEqual(['exact', 'tolerant']);
    expect(matches[0].exact).toBe(true);
    expect(matches[1].exact).toBe(false);
  });

  it('maps outgoing payments to money I owe', () => {
    const rows = [
      row({ participantId: 'owed', direction: 'they_owe_me', shareAmount: 30 }),
      row({ participantId: 'mine', direction: 'i_owe_them', shareAmount: 30 }),
    ];
    const matches = rankSettlementMatches(rows, { amount: 30, direction: 'outgoing' });
    expect(matches.map((match) => match.row.participantId)).toEqual(['mine']);
  });

  it('rejects zero, negative, and NaN amounts', () => {
    const rows = [row({ shareAmount: 0.5 })];
    for (const amount of [0, -30, Number.NaN]) {
      expect(rankSettlementMatches(rows, { amount, direction: 'incoming' })).toEqual([]);
    }
  });

  it('measures the amount against the remaining balance, not the share', () => {
    const rows = [row({ shareAmount: 100, settledAmount: 70 })];
    expect(rankSettlementMatches(rows, { amount: 30, direction: 'incoming' })).toHaveLength(1);
    expect(rankSettlementMatches(rows, { amount: 100, direction: 'incoming' })).toHaveLength(0);
  });

  it('keeps the ₹1 tolerance boundary exact', () => {
    const rows = [row({ shareAmount: 30 })];
    expect(rankSettlementMatches(rows, { amount: 29.0, direction: 'incoming' })).toHaveLength(1);
    expect(rankSettlementMatches(rows, { amount: 30.99, direction: 'incoming' })).toHaveLength(1);
    expect(rankSettlementMatches(rows, { amount: 31.01, direction: 'incoming' })).toHaveLength(0);
  });

  it('orders same-amount ties deterministically regardless of input order', () => {
    const a = row({ participantId: 'a', occurredAt: '2026-10-01T00:00:00Z' });
    const b = row({ participantId: 'b', occurredAt: '2026-10-02T00:00:00Z' });
    const c = row({ participantId: 'c', occurredAt: '2026-10-02T00:00:00Z' });
    const input = { amount: 30, direction: 'incoming' as const };
    const expected = ['a', 'b', 'c'];
    for (const rows of [[a, b, c], [c, b, a], [b, c, a]]) {
      expect(rankSettlementMatches(rows, input).map((m) => m.row.participantId)).toEqual(expected);
    }
  });

  it('does not match names by arbitrary substring', () => {
    const rows = [
      row({ participantId: 'al', counterpartyUsername: 'al99', counterpartyDisplayName: 'Al' }),
      row({ participantId: 'bobby', counterpartyUsername: 'bobby1', counterpartyDisplayName: 'Bobby' }),
      row({ participantId: 'bob', counterpartyUsername: 'bob1', counterpartyDisplayName: 'Bob' }),
    ];
    const alice = rankSettlementMatches(rows, {
      amount: 30,
      direction: 'incoming',
      counterpartyHint: 'Alice',
    });
    expect(alice.some((match) => match.nameMatch)).toBe(false);

    const bob = rankSettlementMatches(rows, {
      amount: 30,
      direction: 'incoming',
      counterpartyHint: 'Bob',
    });
    expect(bob.filter((match) => match.nameMatch).map((m) => m.row.participantId)).toEqual(['bob']);
  });

  it('matches a whole word of a longer bank-statement name', () => {
    const rows = [
      row({ participantId: 'rahul', counterpartyUsername: 'rahul7', counterpartyDisplayName: 'Rahul' }),
      row({ participantId: 'other', counterpartyUsername: 'sam1', counterpartyDisplayName: 'Sam' }),
    ];
    const matches = rankSettlementMatches(rows, {
      amount: 30,
      direction: 'incoming',
      counterpartyHint: 'RAHUL SHARMA',
    });
    expect(matches[0].row.participantId).toBe('rahul');
    expect(matches[0].nameMatch).toBe(true);
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
