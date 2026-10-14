// Pure matching logic for pairing an incoming repayment with the right
// outstanding share. No DB imports, so it is unit-testable in isolation.

export type MatchCandidate = {
  expenseId: string;
  personId: string;
  personName: string;
  remaining: number;
  selfShare: number;
  totalAmount: number;
  label: string | null;
  merchant: string | null;
  occurredAt: string;
};

export function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

// True when every token of the shorter name (after normalization, ignoring
// tokens under two characters) also appears in the longer one. So a partial
// "Anushka" matches "Anushka Gupta" and vice versa, while unrelated names do
// not share tokens.
export function nameMatches(query: string | null, candidate: string): boolean {
  if (!query) return false;
  const queryTokens = normalizeName(query).split(' ').filter((token) => token.length >= 2);
  const candidateTokens = normalizeName(candidate).split(' ').filter((token) => token.length >= 2);
  if (queryTokens.length === 0 || candidateTokens.length === 0) return false;

  const [shorter, longer] =
    queryTokens.length <= candidateTokens.length
      ? [queryTokens, candidateTokens]
      : [candidateTokens, queryTokens];
  return shorter.every((token) => longer.includes(token));
}

// Ranks candidate shares for a receipt. Name is the stronger signal than
// amount, per the product requirement, so the tiers are:
//   0: name match and the amount exactly covers the remainder
//   1: name match only
//   2: amount match only
//   3: everything else, nearest remainder first
// Inside a tier, the most recent expense wins. A null amount is treated as no
// amount signal at all, so it can never satisfy an amount tier.
export function rankCandidates(
  candidates: MatchCandidate[],
  amount: number | null,
  name: string | null
): MatchCandidate[] {
  const amountDistance = (candidate: MatchCandidate): number =>
    amount === null ? Number.POSITIVE_INFINITY : Math.abs(candidate.remaining - amount);

  const tierOf = (candidate: MatchCandidate): number => {
    const matchesName = nameMatches(name, candidate.personName);
    const matchesAmount = amount !== null && candidate.remaining === amount;
    if (matchesName && matchesAmount) return 0;
    if (matchesName) return 1;
    if (matchesAmount) return 2;
    return 3;
  };

  return [...candidates].sort((a, b) => {
    const tierDiff = tierOf(a) - tierOf(b);
    if (tierDiff !== 0) return tierDiff;
    const timeDiff = new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime();
    if (timeDiff !== 0) return timeDiff;
    return amountDistance(a) - amountDistance(b);
  });
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Keep a numeric text field to digits and a single decimal point while typing,
// so intermediate states like "12." stay representable.
export function sanitizeDecimal(raw: string): string {
  let out = raw.replace(/[^0-9.]/g, '');
  const firstDot = out.indexOf('.');
  if (firstDot !== -1) {
    out = out.slice(0, firstDot + 1) + out.slice(firstDot + 1).replace(/\./g, '');
  }
  return out;
}

// Even split of total across partyCount parties, rounded to 2 decimals, with the
// LAST party absorbing the rounding remainder so the array sums EXACTLY to total.
export function resplitEvenly(totalAmount: number, partyCount: number): number[] {
  if (partyCount <= 0) return [];
  const totalCents = Math.round(totalAmount * 100);
  const baseCents = Math.floor(totalCents / partyCount);
  const sharesCents = Array.from({ length: partyCount }, () => baseCents);
  const remainder = totalCents - baseCents * partyCount;
  sharesCents[partyCount - 1] += remainder;
  return sharesCents.map((cents) => Math.round(cents) / 100);
}

// An amount a user can edit alongside a flag marking it as hand-set.
export type RedistributableAmount = { amount: number; locked: boolean };

// The rule behind every editable split: once the user hand-edits an amount it is
// LOCKED, and whatever remains of the total (less every locked amount plus any
// caller-held anchors like your own share) is spread EVENLY across the entries
// still unlocked. `total` here is the pool left for these entries, not the bill.
//
// Greedy re-editing falls out of this naturally — editing a second person locks
// them too, so the remainder collapses onto whoever is left:
//   100 across [A, B, C] even          -> [33.33, 33.33, 33.34]
//   lock A = 50                        -> [50, 25, 25]
//   lock B = 10                        -> [50, 10, 40]
//
// When every entry is locked there is nothing left to spread, so the locked
// amounts are returned unchanged. A negative pool (locked edits overshoot the
// total) is clamped to zero rather than producing negative shares.
export function redistributeSplit(
  total: number,
  entries: RedistributableAmount[]
): number[] {
  const lockedTotal = entries.reduce(
    (sum, entry) => (entry.locked ? sum + entry.amount : sum),
    0
  );
  const unlockedCount = entries.reduce(
    (count, entry) => (entry.locked ? count : count + 1),
    0
  );
  if (unlockedCount === 0) return entries.map((entry) => round2(entry.amount));

  const remainder = round2(Math.max(0, total - lockedTotal));
  const even = resplitEvenly(remainder, unlockedCount);
  let next = 0;
  return entries.map((entry) =>
    entry.locked ? round2(entry.amount) : even[next++]
  );
}

export type SplitRebalance = {
  /** Participant shares, aligned to the input order. */
  shares: number[];
  /** How YOUR share must move to close the gap once every participant is locked. */
  selfDelta: number;
  /**
   * True when the edit cannot be reconciled without a negative share — the locked
   * participants alone already exceed the bill. The caller should reject the edit.
   */
  overflows: boolean;
};

// The full split rule, with YOUR share as the anchor and the final fallback.
//
// While any participant is still unlocked, locked amounts stay put and the pool
// left after your share (total - selfShare) is spread evenly across the
// unlocked ones. Once EVERY participant is locked there is nobody left to
// absorb the difference, so it lands on your own share instead and is reported
// back through `selfDelta` (the UI warns about this readjustment).
//
// `overflows` flags the impossible cases: locked participants alone topping the
// pool (while some are still unlocked) or a self share that would have to go
// negative (once all are locked). Callers must not apply an overflowing result.
export function rebalanceParticipants(
  total: number,
  selfShare: number,
  entries: RedistributableAmount[]
): SplitRebalance {
  const pool = round2(total - selfShare);
  const lockedTotal = round2(
    entries.reduce((sum, entry) => (entry.locked ? sum + entry.amount : sum), 0)
  );
  const unlockedCount = entries.reduce(
    (count, entry) => (entry.locked ? count : count + 1),
    0
  );

  if (unlockedCount === 0) {
    const selfDelta = round2(pool - lockedTotal);
    return {
      shares: entries.map((entry) => round2(entry.amount)),
      selfDelta,
      overflows: round2(selfShare + selfDelta) < 0,
    };
  }

  return {
    shares: redistributeSplit(pool, entries),
    selfDelta: 0,
    overflows: lockedTotal > pool,
  };
}

export type SelfRebalance = {
  /** Participant shares, aligned to the input order. */
  shares: number[];
  /** True when the first participant would have to go below zero. */
  overflows: boolean;
};

// The mirror rule for editing YOUR OWN share. Because you are the one being
// edited, your share is never the fallback — the FIRST participant absorbs the
// whole difference so the rest of the split stays exactly where it was.
//
//   100 = you 0 + [A 50, B 25, C 25]
//   you -> 10                        -> [A 40, B 25, C 25]
//
// `overflows` is set when the shift would force that first participant negative
// (e.g. raising your share past what the others leave room for).
export function rebalanceFromSelf(
  total: number,
  selfShare: number,
  entries: RedistributableAmount[]
): SelfRebalance {
  if (entries.length === 0) return { shares: [], overflows: false };

  const othersTotal = entries
    .slice(1)
    .reduce((sum, entry) => sum + entry.amount, 0);
  const first = round2(total - selfShare - othersTotal);
  if (first < 0) {
    return {
      shares: entries.map((entry) => round2(entry.amount)),
      overflows: true,
    };
  }
  return {
    shares: entries.map((entry, i) => (i === 0 ? first : round2(entry.amount))),
    overflows: false,
  };
}

export type Allocation = { expenseId: string; amount: number };

// Pays a received amount across one or more shares, OLDEST first, taking at most
// each share's remaining balance. Any amount left over after every share is
// covered is returned as `unallocated` so the caller can surface it rather than
// silently inventing a matching debt.
export function allocateGreedy(
  candidates: MatchCandidate[],
  amount: number
): { allocations: Allocation[]; unallocated: number } {
  const ordered = [...candidates].sort(
    (a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime()
  );

  let left = Math.round(Math.max(0, amount) * 100) / 100;
  const allocations: Allocation[] = [];

  for (const candidate of ordered) {
    if (left <= 0.005) break;
    const take = Math.round(Math.min(candidate.remaining, left) * 100) / 100;
    if (take <= 0) continue;
    allocations.push({ expenseId: candidate.expenseId, amount: take });
    left = Math.round((left - take) * 100) / 100;
  }

  return { allocations, unallocated: left > 0.005 ? left : 0 };
}
