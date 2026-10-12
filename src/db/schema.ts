import * as SQLite from 'expo-sqlite';

// Opens (and creates if needed) the local database.
export const db = SQLite.openDatabaseSync('expense-tracker.db');

const SCHEMA_SQL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS people (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  is_self INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  last_used_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS expenses (
  id TEXT PRIMARY KEY,
  amount REAL NOT NULL,
  total_amount REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'INR',
  category_id TEXT NOT NULL REFERENCES categories(id),
  label TEXT,
  merchant TEXT,
  source TEXT NOT NULL CHECK(source IN ('manual', 'sms')),
  bank_source TEXT,
  raw_sms_text TEXT,
  is_split INTEGER NOT NULL DEFAULT 0,
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS expense_participants (
  id TEXT PRIMARY KEY,
  expense_id TEXT NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  person_id TEXT NOT NULL REFERENCES people(id),
  share_amount REAL NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS activity_log (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL CHECK(action IN ('created', 'edited', 'deleted')),
  expense_id TEXT NOT NULL,
  expense_snapshot TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Remembers the last category (and split count) used for a payee so the
-- Android capture flow can auto-file repeat payments without prompting.
CREATE TABLE IF NOT EXISTS merchant_memory (
  merchant TEXT PRIMARY KEY,
  category_id TEXT NOT NULL REFERENCES categories(id),
  split_count INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

-- One money-received event from a person (a repayment, not an expense). Its own
-- ledger: activity_log's CHECK constraint only knows created/edited/deleted, so
-- settlements are tracked here instead.
CREATE TABLE IF NOT EXISTS settlements (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people(id),
  amount REAL NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('manual', 'sms')),
  bank_source TEXT,
  raw_sms_text TEXT,
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Which participant share(s) a settlement pays down. A settlement can cover
-- several expenses, and a single share can be paid down by several settlements;
-- remaining is always derived as share_amount - SUM(allocations).
CREATE TABLE IF NOT EXISTS settlement_allocations (
  id TEXT PRIMARY KEY,
  settlement_id TEXT NOT NULL REFERENCES settlements(id) ON DELETE CASCADE,
  expense_id TEXT NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  person_id TEXT NOT NULL REFERENCES people(id),
  amount REAL NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Remembers a UPI id (VPA) against a person's custom display name, so a credit
-- from "anushka@okhdfc" auto-fills "Anushka" next time instead of asking. Stored
-- lowercased; UPI ids are case-insensitive.
--
-- Superseded by person_handles, which also covers name variants. Kept only as a
-- migration source (see migrateUpiAliasesToHandles); nothing reads or writes it
-- anymore.
CREATE TABLE IF NOT EXISTS upi_aliases (
  upi_id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people(id),
  updated_at TEXT NOT NULL
);

-- Every handle that identifies a person: a UPI id (VPA) or a name spelling they
-- are known by. handle_key is the normalized form (lowercased, whitespace
-- collapsed), so "anushka@okhdfc"/"Anushka@okhdfc" and "Anushka  Gupta"/
-- "anushka gupta" each resolve to one row. A person can have many handles, and a
-- known handle is how an incoming sender is recognized across banks/apps or a
-- differently formatted name.
CREATE TABLE IF NOT EXISTS person_handles (
  handle_key TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('name', 'upi')),
  label TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Locked-phone cache of a credit SMS: the raw text is captured immediately and
-- awaits review, then linked to a settlement or dismissed. Never auto-files.
CREATE TABLE IF NOT EXISTS incoming_receipts (
  id TEXT PRIMARY KEY,
  raw_sms_text TEXT NOT NULL,
  bank_source TEXT,
  parsed_amount REAL,
  parsed_name TEXT,
  status TEXT NOT NULL CHECK(status IN ('pending', 'linked', 'dismissed')),
  received_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;

export function initDatabase(): void {
  db.execSync(SCHEMA_SQL);
  migrateUpiAliasesToHandles();
}

// One-time fold of the legacy upi_aliases table into person_handles. Guarded on
// person_handles being empty, so it runs at most once and a handle the user
// later removes is never resurrected on the next launch. The copy runs inside a
// transaction, so an interrupted upgrade leaves it all-or-nothing rather than
// half-migrated with the guard then blocking the rest.
function migrateUpiAliasesToHandles(): void {
  const hasHandles = db.getFirstSync<{ one: number }>(
    'SELECT 1 AS one FROM person_handles LIMIT 1'
  );
  if (hasHandles) return;

  const legacy = db.getAllSync<{ upi_id: string; person_id: string; updated_at: string }>(
    'SELECT upi_id, person_id, updated_at FROM upi_aliases'
  );
  if (legacy.length === 0) return;

  const now = new Date().toISOString();
  db.withTransactionSync(() => {
    for (const row of legacy) {
      const key = row.upi_id.trim().toLowerCase();
      if (!key) continue;
      db.runSync(
        `INSERT OR IGNORE INTO person_handles
           (handle_key, person_id, kind, label, created_at, updated_at)
         VALUES (?, ?, 'upi', ?, ?, ?)`,
        key,
        row.person_id,
        row.upi_id,
        now,
        row.updated_at ?? now
      );
    }
  });
}
