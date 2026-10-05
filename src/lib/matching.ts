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
