import { randomUUID } from 'expo-crypto';

import { findOrCreatePerson } from './people';
import type { PersonRow } from './people';
import { db } from './schema';

export interface SettlementRow {
  id: string;
  person_id: string;
  person_name: string | null; // joined
  amount: number;
  source: string;
  bank_source: string | null;
  raw_sms_text: string | null;
  occurred_at: string;
  created_at: string;
  updated_at: string;
}

export type OutstandingShare = {
  expenseId: string;
  label: string | null;
  merchant: string | null;
  totalAmount: number;
  selfShare: number;
  occurredAt: string;
  personId: string;
  personName: string;
  shareAmount: number;
  receivedAmount: number;
  remaining: number;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// The received-side ledger. A share counts as outstanding until allocations
// cover it; remaining is never stored, only derived, so it can't drift.
const OUTSTANDING_SQL = `
  SELECT ep.expense_id, ep.person_id, p.display_name,
         e.label, e.merchant, e.total_amount, e.amount AS self_share, e.occurred_at,
         ep.share_amount, COALESCE(sa.received, 0) AS received_amount
  FROM expense_participants ep
  JOIN people p ON p.id = ep.person_id
  JOIN expenses e ON e.id = ep.expense_id
  LEFT JOIN (
    SELECT expense_id, person_id, SUM(amount) AS received
    FROM settlement_allocations
    GROUP BY expense_id, person_id
  ) sa ON sa.expense_id = ep.expense_id AND sa.person_id = ep.person_id
`;

type OutstandingRow = {
  expense_id: string;
  person_id: string;
  display_name: string;
  label: string | null;
  merchant: string | null;
  total_amount: number;
  self_share: number;
  occurred_at: string;
  share_amount: number;
  received_amount: number;
};

function mapOutstanding(row: OutstandingRow): OutstandingShare {
  const shareAmount = round2(row.share_amount);
  const receivedAmount = round2(row.received_amount);
  return {
    expenseId: row.expense_id,
    label: row.label,
    merchant: row.merchant,
    totalAmount: round2(row.total_amount),
    selfShare: round2(row.self_share),
    occurredAt: row.occurred_at,
    personId: row.person_id,
    personName: row.display_name,
    shareAmount,
    receivedAmount,
    remaining: round2(shareAmount - receivedAmount),
  };
}

// A participant share with remaining > 0, across all expenses.
export function listOutstandingShares(): OutstandingShare[] {
  return db
    .getAllSync<OutstandingRow>(
      `${OUTSTANDING_SQL}
       WHERE (ep.share_amount - COALESCE(sa.received, 0)) > 0.005
       ORDER BY e.occurred_at DESC`
    )
    .map(mapOutstanding);
}

// One person's slice of what they still owe: the expense, the part they carry,
// and what is left after repayments.
export type OwedItem = {
  expenseId: string;
  label: string | null;
  merchant: string | null;
  occurredAt: string;
  shareAmount: number;
  receivedAmount: number;
  remaining: number;
};

// Everything owed to you by one person (or by the nameless bucket), newest
// expense first, with the group total still outstanding.
export type OwedGroup = {
  /** personId, or the sentinel key for the nameless group. */
  key: string;
  name: string;
  unnamed: boolean;
  totalRemaining: number;
  items: OwedItem[];
};

// The split step creates "Person 2", "Person 3"… when a participant is left
// unnamed, so those count as nameless rather than as real people.
const NAMELESS_KEY = '__nameless__';
const NAMELESS_NAME = 'Unnamed';
const PLACEHOLDER_NAME = /^person\s*\d+$/i;

function isNameless(name: string): boolean {
  const trimmed = name.trim();
  return trimmed === '' || PLACEHOLDER_NAME.test(trimmed);
}

type NamelessRow = {
  expense_id: string;
  label: string | null;
  merchant: string | null;
  occurred_at: string;
  unassigned: number;
};

// "Who owes me what", grouped by person. Participant shares are grouped under
// their person; a split's unassigned remainder (a bill shared with fewer named
// people than shares) and any placeholder/blank participant land in a single
// "Unnamed" group pinned to the bottom.
//
// `includeSettled` also returns shares that have been fully repaid, so the same
// list doubles as history.
export function listOwedByPerson(includeSettled = false): OwedGroup[] {
  const groups = new Map<string, OwedGroup>();

  const groupFor = (key: string, name: string, unnamed: boolean): OwedGroup => {
    const existing = groups.get(key);
    if (existing) return existing;
    const created: OwedGroup = { key, name, unnamed, totalRemaining: 0, items: [] };
    groups.set(key, created);
    return created;
  };

  const shares = db.getAllSync<OutstandingRow>(
    `${OUTSTANDING_SQL} ORDER BY e.occurred_at DESC`
  );
  for (const row of shares) {
    const shareAmount = round2(row.share_amount);
    const receivedAmount = round2(row.received_amount);
    const remaining = round2(Math.max(0, shareAmount - receivedAmount));
    if (!includeSettled && remaining <= 0.005) continue;

    const unnamed = isNameless(row.display_name);
    const group = groupFor(
      unnamed ? NAMELESS_KEY : row.person_id,
      unnamed ? NAMELESS_NAME : row.display_name,
      unnamed
    );
    group.items.push({
      expenseId: row.expense_id,
      label: row.label,
      merchant: row.merchant,
      occurredAt: row.occurred_at,
      shareAmount,
      receivedAmount,
      remaining,
    });
  }

  // A split's remainder nobody was named for: the bill share above your own that
  // no participant row accounts for.
  const nameless = db.getAllSync<NamelessRow>(
    `SELECT e.id AS expense_id, e.label, e.merchant, e.occurred_at,
            (e.total_amount - e.amount) - COALESCE(p.shares, 0) AS unassigned
     FROM expenses e
     LEFT JOIN (
       SELECT expense_id, SUM(share_amount) AS shares
       FROM expense_participants
       GROUP BY expense_id
     ) p ON p.expense_id = e.id
     WHERE e.is_split = 1
     ORDER BY e.occurred_at DESC`
  );
  for (const row of nameless) {
    const amount = round2(row.unassigned);
    if (amount <= 0.005) continue;
    const group = groupFor(NAMELESS_KEY, NAMELESS_NAME, true);
    group.items.push({
      expenseId: row.expense_id,
      label: row.label,
      merchant: row.merchant,
      occurredAt: row.occurred_at,
      shareAmount: amount,
      receivedAmount: 0,
      remaining: amount,
    });
  }

  const result = [...groups.values()];
  for (const group of result) {
    group.items.sort(
      (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()
    );
    group.totalRemaining = round2(
      group.items.reduce((sum, item) => sum + item.remaining, 0)
    );
  }

  // People alphabetically; the nameless bucket always last.
  result.sort((a, b) => {
    if (a.unnamed !== b.unnamed) return a.unnamed ? 1 : -1;
    return a.name.localeCompare(b.name);
  });

  return result;
}

// Every transaction one person carries a share of — outstanding AND already
// settled — newest first. This is the drill-down behind a person on the "Owed
// to you" screen, so it deliberately has no remaining filter.
export function listPersonOwed(personId: string): OwedItem[] {
  return db
    .getAllSync<OutstandingRow>(
      `${OUTSTANDING_SQL}
       WHERE ep.person_id = ?
       ORDER BY e.occurred_at DESC`,
      personId
    )
    .map((row) => {
      const shareAmount = round2(row.share_amount);
      const receivedAmount = round2(row.received_amount);
      return {
        expenseId: row.expense_id,
        label: row.label,
        merchant: row.merchant,
        occurredAt: row.occurred_at,
        shareAmount,
        receivedAmount,
        remaining: round2(Math.max(0, shareAmount - receivedAmount)),
      };
    });
}

export type InsertSettlementInput = {
  personName: string; // find-or-create
  amount: number; // total received
  source: 'manual' | 'sms';
  bankSource: string | null;
  rawSmsText: string | null;
  occurredAt: string; // ISO
  // One allocation per expense this receipt pays down. personId is the settlement person.
  allocations: { expenseId: string; amount: number }[];
};

// Atomically records one money-received event and how it pays down shares: the
// settlements row plus its settlement_allocations rows, all-or-nothing. The
// person is find-or-created first so the allocations share their id.
export function insertSettlement(input: InsertSettlementInput): {
  settlementId: string;
  personId: string;
} {
  const settlementId = randomUUID();
  const now = new Date().toISOString();
  const amount = round2(Math.max(0, input.amount));

  let personId = '';
  db.withTransactionSync(() => {
    const person: PersonRow = findOrCreatePerson(input.personName);
    personId = person.id;

    db.runSync(
      `INSERT INTO settlements
         (id, person_id, amount, source, bank_source, raw_sms_text,
          occurred_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      settlementId,
      person.id,
      amount,
      input.source,
      input.bankSource,
      input.rawSmsText,
      input.occurredAt,
      now,
      now
    );

    for (const allocation of input.allocations) {
      db.runSync(
        `INSERT INTO settlement_allocations
           (id, settlement_id, expense_id, person_id, amount, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        randomUUID(),
        settlementId,
        allocation.expenseId,
        person.id,
        round2(allocation.amount),
        now,
        now
      );
    }
  });

  return { settlementId, personId };
}

export function listSettlements(limit = 100): SettlementRow[] {
  return db.getAllSync<SettlementRow>(
    `SELECT s.*, p.display_name AS person_name
     FROM settlements s
     LEFT JOIN people p ON p.id = s.person_id
     ORDER BY s.occurred_at DESC, s.created_at DESC LIMIT ?`,
    limit
  );
}

// Sum of settlement.amount with occurred_at >= given ISO string.
export function receivedTotalSince(isoDate: string): number {
  const total =
    db.getFirstSync<{ total: number }>(
      'SELECT COALESCE(SUM(amount), 0) AS total FROM settlements WHERE occurred_at >= ?',
      isoDate
    )?.total ?? 0;
  return round2(total);
}

// Sum of all remaining across outstanding shares, including the nameless
// remainder of a partially named split. Derived from listOwedByPerson so the
// Home card and the "Owed to you" screen can never disagree.
export function totalOutstanding(): number {
  return round2(
    listOwedByPerson(false).reduce((sum, group) => sum + group.totalRemaining, 0)
  );
}

// Person's outstanding total (sum remaining for that person).
export function outstandingForPerson(personId: string): number {
  const total =
    db.getFirstSync<{ total: number }>(
      `SELECT COALESCE(SUM(ep.share_amount - COALESCE(sa.received, 0)), 0) AS total
       FROM expense_participants ep
       LEFT JOIN (
         SELECT expense_id, person_id, SUM(amount) AS received
         FROM settlement_allocations
         GROUP BY expense_id, person_id
       ) sa ON sa.expense_id = ep.expense_id AND sa.person_id = ep.person_id
       WHERE ep.person_id = ?
         AND (ep.share_amount - COALESCE(sa.received, 0)) > 0.005`,
      personId
    )?.total ?? 0;
  return round2(total);
}
