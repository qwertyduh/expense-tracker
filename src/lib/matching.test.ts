import { describe, expect, it } from 'vitest';

import { normalizeName, nameMatches, rankCandidates, resplitEvenly, allocateGreedy } from './matching';
import type { MatchCandidate } from './matching';

describe('normalizeName', () => {
  it('lowercases, trims and collapses whitespace', () => {
    expect(normalizeName('  Anushka   Gupta ')).toBe('anushka gupta');
  });
});

describe('nameMatches', () => {
  it('matches case-insensitively', () => {
    expect(nameMatches('anushka', 'Anushka Gupta')).toBe(true);
  });

  it('matches a partial name in either direction', () => {
    expect(nameMatches('Anushka Gupta', 'anushka')).toBe(true);
    expect(nameMatches('Gupta', 'Anushka Gupta')).toBe(true);
  });

  it('requires token overlap', () => {
    expect(nameMatches('Anushka Gupta', 'Rohan Bansal')).toBe(false);
    expect(nameMatches('Anushka Gupta', 'Rohan Gupta')).toBe(false);
  });

  it('treats a missing query as no match', () => {
    expect(nameMatches(null, 'Anushka Gupta')).toBe(false);
    expect(nameMatches('', 'Anushka Gupta')).toBe(false);
  });

  it('ignores tokens shorter than two characters', () => {
    expect(nameMatches('a', 'Anushka Gupta')).toBe(false);
  });
});

function candidate(overrides: Partial<MatchCandidate> & { expenseId: string }): MatchCandidate {
  return {
    personId: `p-${overrides.expenseId}`,
    personName: 'Someone',
    remaining: 100,
    selfShare: 0,
    totalAmount: 100,
    label: null,
    merchant: null,
    occurredAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('rankCandidates', () => {
  it('orders name+amount > name-only > amount-only > rest', () => {
    const nameAmount = candidate({
      expenseId: 'name-amount',
      personName: 'Anushka Gupta',
      remaining: 500,
    });
    const nameOnly = candidate({ expenseId: 'name-only', personName: 'Anushka Gupta', remaining: 300 });
    const amountOnly = candidate({ expenseId: 'amount-only', personName: 'Rohan', remaining: 500 });
    const rest = candidate({ expenseId: 'rest', personName: 'Rohan', remaining: 999 });

    const ranked = rankCandidates([rest, amountOnly, nameOnly, nameAmount], 500, 'Anushka Gupta');

    expect(ranked.map((c) => c.expenseId)).toEqual([
      'name-amount',
      'name-only',
      'amount-only',
      'rest',
    ]);
  });

  it('treats a null amount as no amount signal', () => {
    const nameMatch = candidate({ expenseId: 'name', personName: 'Anushka Gupta', remaining: 500 });
    const other = candidate({ expenseId: 'other', personName: 'Rohan', remaining: 500 });

    const ranked = rankCandidates([other, nameMatch], null, 'Anushka Gupta');
    expect(ranked.map((c) => c.expenseId)).toEqual(['name', 'other']);
  });

  it('breaks ties inside a tier by occurredAt DESC', () => {
    const older = candidate({
      expenseId: 'older',
      personName: 'Anushka Gupta',
      remaining: 500,
      occurredAt: '2026-07-01T00:00:00.000Z',
    });
    const newer = candidate({
      expenseId: 'newer',
      personName: 'Anushka Gupta',
      remaining: 500,
      occurredAt: '2026-08-01T00:00:00.000Z',
    });

    const ranked = rankCandidates([older, newer], 500, 'Anushka Gupta');
    expect(ranked.map((c) => c.expenseId)).toEqual(['newer', 'older']);
  });

  it('orders the residual tier by nearest remainder', () => {
    const close = candidate({ expenseId: 'close', personName: 'Rohan', remaining: 480 });
    const far = candidate({ expenseId: 'far', personName: 'Rohan', remaining: 900 });

    const ranked = rankCandidates([far, close], 500, 'Nobody Matches');
    expect(ranked.map((c) => c.expenseId)).toEqual(['close', 'far']);
  });
});

describe('resplitEvenly', () => {
  it('sums exactly to the total with the last party absorbing rounding', () => {
    const shares = resplitEvenly(100, 3);
    expect(shares).toEqual([33.33, 33.33, 33.34]);
    expect(shares.reduce((sum, n) => sum + Math.round(n * 100), 0)).toBe(10000);
  });

  it('handles a non-round split', () => {
    const shares = resplitEvenly(10, 3);
    expect(shares).toEqual([3.33, 3.33, 3.34]);
    expect(shares.reduce((sum, n) => sum + Math.round(n * 100), 0)).toBe(1000);
  });

  it('divides cleanly when it can', () => {
    expect(resplitEvenly(100, 4)).toEqual([25, 25, 25, 25]);
  });

  it('returns one share for one party', () => {
    expect(resplitEvenly(42.5, 1)).toEqual([42.5]);
  });

  it('returns an empty list for no parties', () => {
    expect(resplitEvenly(100, 0)).toEqual([]);
  });
});

describe('allocateGreedy', () => {
  it('pays the oldest share first, then the next', () => {
    const older = candidate({
      expenseId: 'older',
      remaining: 200,
      occurredAt: '2026-07-01T00:00:00.000Z',
    });
    const newer = candidate({
      expenseId: 'newer',
      remaining: 300,
      occurredAt: '2026-08-01T00:00:00.000Z',
    });

    const { allocations, unallocated } = allocateGreedy([newer, older], 400);
    expect(allocations).toEqual([
      { expenseId: 'older', amount: 200 },
      { expenseId: 'newer', amount: 200 },
    ]);
    expect(unallocated).toBe(0);
  });

  it('splits a partial payment across one share', () => {
    const share = candidate({ expenseId: 'a', remaining: 500, occurredAt: '2026-07-01T00:00:00.000Z' });
    const { allocations, unallocated } = allocateGreedy([share], 200);
    expect(allocations).toEqual([{ expenseId: 'a', amount: 200 }]);
    expect(unallocated).toBe(0);
  });

  it('surfaces any amount beyond every remaining balance', () => {
    const share = candidate({ expenseId: 'a', remaining: 100, occurredAt: '2026-07-01T00:00:00.000Z' });
    const { allocations, unallocated } = allocateGreedy([share], 250);
    expect(allocations).toEqual([{ expenseId: 'a', amount: 100 }]);
    expect(unallocated).toBe(150);
  });
});
