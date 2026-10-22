import { db } from './schema';

export type SharedDebtRow = {
  participantId: string;
  expenseId: string;
  direction: 'they_owe_me' | 'i_owe_them';
  counterpartyUserId: string;
  counterpartyUsername: string;
  counterpartyDisplayName: string;
  totalAmount: number;
  label: string | null;
  occurredAt: string;
  shareAmount: number;
  settledAmount: number;
  status: 'pending' | 'paid' | 'disputed';
  updatedAt: string;
};

type DbRow = {
  id: string;
  expense_id: string;
  direction: 'they_owe_me' | 'i_owe_them';
  counterparty_user_id: string;
  counterparty_username: string;
  counterparty_display_name: string;
  total_amount: number;
  label: string | null;
  occurred_at: string;
  share_amount: number;
  settled_amount: number;
  status: 'pending' | 'paid' | 'disputed';
  updated_at: string;
};

function mapRow(row: DbRow): SharedDebtRow {
  return {
    participantId: row.id,
    expenseId: row.expense_id,
    direction: row.direction,
    counterpartyUserId: row.counterparty_user_id,
    counterpartyUsername: row.counterparty_username,
    counterpartyDisplayName: row.counterparty_display_name,
    totalAmount: row.total_amount,
    label: row.label,
    occurredAt: row.occurred_at,
    shareAmount: row.share_amount,
    settledAmount: row.settled_amount,
    status: row.status,
    updatedAt: row.updated_at,
  };
}

export function replaceSharedDebtCache(rows: SharedDebtRow[]): void {
  const now = new Date().toISOString();
  db.withTransactionSync(() => {
    db.runSync('DELETE FROM shared_debt_cache');
    for (const row of rows) {
      db.runSync(
        `INSERT INTO shared_debt_cache
           (id, expense_id, direction, counterparty_user_id,
            counterparty_username, counterparty_display_name, total_amount,
            label, occurred_at, share_amount, settled_amount, status, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        row.participantId,
        row.expenseId,
        row.direction,
        row.counterpartyUserId,
        row.counterpartyUsername,
        row.counterpartyDisplayName,
        row.totalAmount,
        row.label,
        row.occurredAt,
        row.shareAmount,
        row.settledAmount,
        row.status,
        row.updatedAt || now
      );
    }
  });
}

// Account-scoped data: cleared on sign-out so debts are never shown to the
// next account on the device.
export function clearSharedDebtCache(): void {
  db.runSync('DELETE FROM shared_debt_cache');
}

export function listSharedDebtRows(): SharedDebtRow[] {
  return db
    .getAllSync<DbRow>(
      'SELECT * FROM shared_debt_cache ORDER BY occurred_at DESC'
    )
    .map(mapRow);
}

export function updateCachedShare(
  participantId: string,
  status: SharedDebtRow['status'],
  settledAmount: number
): void {
  db.runSync(
    `UPDATE shared_debt_cache
        SET status = ?, settled_amount = ?, updated_at = ?
      WHERE id = ?`,
    status,
    settledAmount,
    new Date().toISOString(),
    participantId
  );
}

export type PairBalance = {
  userId: string;
  username: string;
  displayName: string;
  net: number;
  rows: SharedDebtRow[];
};

// Positive net = they owe you; negative net = you owe them.
export function listPairBalances(): PairBalance[] {
  const rows = listSharedDebtRows();
  const groups = new Map<string, PairBalance>();

  for (const row of rows) {
    if (row.status !== 'pending') continue;
    const remaining = Math.max(0, row.shareAmount - row.settledAmount);
    if (remaining <= 0.005) continue;

    let group = groups.get(row.counterpartyUserId);
    if (!group) {
      group = {
        userId: row.counterpartyUserId,
        username: row.counterpartyUsername,
        displayName: row.counterpartyDisplayName,
        net: 0,
        rows: [],
      };
      groups.set(row.counterpartyUserId, group);
    }
    group.net += row.direction === 'they_owe_me' ? remaining : -remaining;
    group.rows.push(row);
  }

  return [...groups.values()]
    .map((group) => ({ ...group, net: Math.round(group.net * 100) / 100 }))
    .filter((group) => Math.abs(group.net) > 0.005)
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}
