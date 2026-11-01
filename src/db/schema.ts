import * as SQLite from 'expo-sqlite';

// Opens (and creates if needed) the local database.
export const db = SQLite.openDatabaseSync('expense-tracker.db');

const SCHEMA_SQL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS people (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  is_self INTEGER NOT NULL DEFAULT 0,
  remote_user_id TEXT,
  username TEXT,
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
  split_pending INTEGER NOT NULL DEFAULT 0,
  shared_expense_id TEXT,
  sync_status TEXT NOT NULL DEFAULT 'local',
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS expense_participants (
  id TEXT PRIMARY KEY,
  expense_id TEXT NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  person_id TEXT NOT NULL REFERENCES people(id),
  participant_user_id TEXT,
  share_amount REAL NOT NULL,
  share_status TEXT NOT NULL DEFAULT 'local',
  remote_participant_id TEXT,
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
  remote_settlement_id TEXT,
  sync_status TEXT NOT NULL DEFAULT 'local',
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

-- Local cache of accepted friends and pending requests, so the split flow can
-- offer usernames while offline.
CREATE TABLE IF NOT EXISTS friend_cache (
  user_id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending', 'accepted', 'declined', 'blocked')),
  direction TEXT CHECK(direction IN ('incoming', 'outgoing')),
  friendship_id TEXT,
  updated_at TEXT NOT NULL
);

-- Mirror of shared-expense participant rows involving this user. One row per
-- participant share: direction says whether they owe you or you owe them.
CREATE TABLE IF NOT EXISTS shared_debt_cache (
  id TEXT PRIMARY KEY,
  expense_id TEXT NOT NULL,
  direction TEXT NOT NULL CHECK(direction IN ('they_owe_me', 'i_owe_them')),
  counterparty_user_id TEXT NOT NULL,
  counterparty_username TEXT NOT NULL,
  counterparty_display_name TEXT NOT NULL,
  total_amount REAL NOT NULL,
  label TEXT,
  occurred_at TEXT NOT NULL,
  share_amount REAL NOT NULL,
  settled_amount REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK(status IN ('pending', 'paid', 'disputed')),
  updated_at TEXT NOT NULL
);

-- Durable queue for writes that must reach Supabase. Local-only rows are never
-- enqueued. entity_id is the local row id (also the remote id where possible).
CREATE TABLE IF NOT EXISTS sync_outbox (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  payload TEXT NOT NULL,
  user_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Small key/value store for pull cursors and other sync bookkeeping.
CREATE TABLE IF NOT EXISTS sync_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

`;

export function initDatabase(): void {
  db.execSync(SCHEMA_SQL);
  migrateAddColumns();
  migrateUpiAliasesToHandles();
}

// `CREATE TABLE IF NOT EXISTS` cannot add columns to an existing install, so
// every schema addition also needs an idempotent ALTER here.
function addColumnIfMissing(table: string, column: string, definition: string): void {
  const columns = db.getAllSync<{ name: string }>(`PRAGMA table_info(${table})`);
  if (columns.some((existing) => existing.name === column)) return;
  db.execSync(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function migrateAddColumns(): void {
  addColumnIfMissing('people', 'remote_user_id', 'TEXT');
  addColumnIfMissing('people', 'username', 'TEXT');
  addColumnIfMissing('expenses', 'split_pending', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing('expenses', 'shared_expense_id', 'TEXT');
  addColumnIfMissing('expenses', 'sync_status', "TEXT NOT NULL DEFAULT 'local'");
  addColumnIfMissing('expense_participants', 'participant_user_id', 'TEXT');
  addColumnIfMissing('expense_participants', 'share_status', "TEXT NOT NULL DEFAULT 'local'");
  addColumnIfMissing('expense_participants', 'remote_participant_id', 'TEXT');
  addColumnIfMissing('settlements', 'remote_settlement_id', 'TEXT');
  addColumnIfMissing('settlements', 'sync_status', "TEXT NOT NULL DEFAULT 'local'");
  addColumnIfMissing('sync_outbox', 'user_id', 'TEXT');
  addColumnIfMissing('sync_outbox', 'status', "TEXT NOT NULL DEFAULT 'pending'");
  db.execSync(
    'CREATE UNIQUE INDEX IF NOT EXISTS people_remote_user_idx ON people(remote_user_id) WHERE remote_user_id IS NOT NULL'
  );
  db.execSync(
    'CREATE INDEX IF NOT EXISTS sync_outbox_due_idx ON sync_outbox(user_id, status, next_attempt_at)'
  );
  migrateOutboxOwnership();
}

// Rows queued before user scoping existed have no owner. Attribute them to the
// signed-in self profile once (never to whoever happens to sign in later), and
// quarantine anything still unowned so it is surfaced rather than replayed
// under the wrong account.
function migrateOutboxOwnership(): void {
  const done = db.getFirstSync<{ value: string }>(
    "SELECT value FROM sync_state WHERE key = 'outbox_user_backfill_done' LIMIT 1"
  );
  if (done) return;

  const self = db.getFirstSync<{ remote_user_id: string | null }>(
    'SELECT remote_user_id FROM people WHERE is_self = 1 LIMIT 1'
  );
  const now = new Date().toISOString();
  db.withTransactionSync(() => {
    if (self?.remote_user_id) {
      db.runSync(
        `UPDATE sync_outbox
            SET user_id = ?, updated_at = ?
          WHERE user_id IS NULL`,
        self.remote_user_id,
        now
      );
    }
    db.runSync(
      `UPDATE sync_outbox
          SET status = 'failed',
              last_error = COALESCE(last_error, 'missing_user'),
              updated_at = ?
        WHERE user_id IS NULL`,
      now
    );
    db.runSync(
      `INSERT OR REPLACE INTO sync_state (key, value, updated_at)
       VALUES ('outbox_user_backfill_done', '1', ?)`,
      now
    );
  });
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
