import { randomUUID } from 'expo-crypto';

import type { SharedExpenseDraft } from '@/db/expenses';
import { db } from '@/db/schema';
import {
  backoffDelayMs,
  classifySyncError,
  MAX_SYNC_ATTEMPTS,
  outboxRowId,
  syncErrorMessage,
} from '@/lib/sync-errors';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

type OutboxRow = {
  id: string;
  entity_type: string;
  entity_id: string;
  operation: string;
  payload: string;
  attempts: number;
  user_id: string | null;
};

export type SyncStatus = {
  pending: number;
  failed: number;
  lastError: string | null;
};

const ACTIVE_USER_KEY = 'active_user_id';

function nowIso(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Active account
// ---------------------------------------------------------------------------

export function setActiveUserId(userId: string): void {
  db.runSync(
    `INSERT OR REPLACE INTO sync_state (key, value, updated_at)
     VALUES (?, ?, ?)`,
    ACTIVE_USER_KEY,
    userId,
    nowIso()
  );
}

export function clearActiveUserId(): void {
  db.runSync('DELETE FROM sync_state WHERE key = ?', ACTIVE_USER_KEY);
}

// Only the value written by AuthProvider counts. There is deliberately no
// fallback to people.remote_user_id: after sign-out that still points at the
// previous account, which is exactly the value that must never flush again.
export function getActiveUserId(): string | null {
  const stored = db.getFirstSync<{ value: string }>(
    'SELECT value FROM sync_state WHERE key = ? LIMIT 1',
    ACTIVE_USER_KEY
  );
  return stored?.value ?? null;
}

// ---------------------------------------------------------------------------
// Outbox
// ---------------------------------------------------------------------------

type SharedExpensePayload = {
  id: string;
  totalAmount: number;
  ownerShare: number;
  label: string | null;
  occurredAt: string;
  participants: { username: string; shareAmount: number }[];
};

function enqueue(
  entityType: string,
  entityId: string,
  operation: string,
  payload: unknown
): void {
  const now = nowIso();
  const userId = getActiveUserId();
  // Queued while signed out: keep the write but quarantine it so it is shown
  // to the user and never replayed under the next account automatically.
  const status = userId ? 'pending' : 'failed';
  db.runSync(
    `INSERT INTO sync_outbox
       (id, entity_type, entity_id, operation, payload, user_id, status,
        attempts, next_attempt_at, last_error, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       payload = excluded.payload,
       user_id = excluded.user_id,
       status = excluded.status,
       attempts = 0,
       next_attempt_at = NULL,
       last_error = excluded.last_error,
       updated_at = excluded.updated_at`,
    outboxRowId(entityType, entityId, operation),
    entityType,
    entityId,
    operation,
    JSON.stringify(payload),
    userId,
    status,
    userId ? null : 'missing_user',
    now,
    now
  );
}

export function enqueueSharedExpenseUpdate(draft: SharedExpensePayload): void {
  enqueue('shared_expense', draft.id, 'update', {
    id: draft.id,
    total_amount: draft.totalAmount,
    owner_share: draft.ownerShare,
    label: draft.label,
    occurred_at: draft.occurredAt,
    participants: draft.participants.map((participant) => ({
      username: participant.username,
      share_amount: participant.shareAmount,
    })),
  });
}

export function enqueueSharedExpenseVoid(expenseId: string): void {
  enqueue('shared_expense', expenseId, 'void', { id: expenseId });
}

export function enqueueSharedExpense(draft: SharedExpenseDraft): void {
  enqueue('shared_expense', draft.id, 'create', {
    id: draft.id,
    total_amount: draft.totalAmount,
    owner_share: draft.ownerShare,
    label: draft.label,
    occurred_at: draft.occurredAt,
    participants: draft.participants.map((participant) => ({
      username: participant.username,
      share_amount: participant.shareAmount,
    })),
  });
}

// Drop a queued (pending or failed) operation, e.g. a void that the user undid
// by adding a friend back before it was sent.
export function cancelOutbox(entityType: string, entityId: string, operation: string): void {
  db.runSync('DELETE FROM sync_outbox WHERE id = ?', outboxRowId(entityType, entityId, operation));
}

export type SettlementMethod = 'manual' | 'detected_incoming' | 'detected_outgoing';

export type SettlementPayload = {
  participantId: string;
  expenseId: string;
  amount: number;
  method: SettlementMethod;
  idempotencyKey: string;
};

// One intent per user action. The idempotency key is generated here, persisted
// with the row, and reused by every retry, so a lost response can never create
// a second settlement on the server.
export function enqueueSettlement(
  input: Omit<SettlementPayload, 'idempotencyKey'>
): { intentId: string; idempotencyKey: string } {
  const intentId = randomUUID();
  const idempotencyKey = randomUUID();
  enqueue('shared_settlement', intentId, 'settle', {
    ...input,
    idempotencyKey,
  });
  return { intentId, idempotencyKey };
}

export type SettlementState = {
  state: 'synced' | 'pending' | 'failed';
  error: string | null;
};

// A settlement row disappears only after the RPC succeeded.
export function getSettlementState(intentId: string): SettlementState {
  const row = db.getFirstSync<{ status: 'pending' | 'failed'; last_error: string | null }>(
    `SELECT status, last_error FROM sync_outbox
      WHERE entity_type = 'shared_settlement'
        AND operation = 'settle'
        AND entity_id = ?
      LIMIT 1`,
    intentId
  );
  if (!row) return { state: 'synced', error: null };
  return {
    state: row.status === 'failed' ? 'failed' : 'pending',
    error: row.last_error,
  };
}

function dueRows(userId: string): OutboxRow[] {
  return db.getAllSync<OutboxRow>(
    `SELECT id, entity_type, entity_id, operation, payload, attempts, user_id
       FROM sync_outbox
      WHERE user_id = ?
        AND status = 'pending'
        AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
      ORDER BY created_at ASC, rowid ASC
      LIMIT 20`,
    userId,
    nowIso()
  );
}

function removeRow(id: string): void {
  db.runSync('DELETE FROM sync_outbox WHERE id = ?', id);
}

function markExpenseSyncStatus(entityId: string, status: 'synced' | 'failed'): void {
  db.runSync(
    `UPDATE expenses SET sync_status = ?, updated_at = ?
      WHERE id = ? OR shared_expense_id = ?`,
    status,
    nowIso(),
    entityId,
    entityId
  );
}

function failRow(row: OutboxRow, error: unknown): void {
  const attempts = row.attempts + 1;
  const kind = classifySyncError(error);
  const message = syncErrorMessage(error).slice(0, 500);
  // A permanent rejection or exhausted retries become visible failures instead
  // of looping forever. Failed rows are only retried from the UI.
  const failed = kind === 'permanent' || attempts >= MAX_SYNC_ATTEMPTS;
  const nextAttemptAt = failed ? null : new Date(Date.now() + backoffDelayMs(attempts)).toISOString();

  db.runSync(
    `UPDATE sync_outbox
        SET attempts = ?,
            last_error = ?,
            next_attempt_at = ?,
            status = ?,
            updated_at = ?
      WHERE id = ?`,
    attempts,
    message,
    nextAttemptAt,
    failed ? 'failed' : 'pending',
    nowIso(),
    row.id
  );

  if (failed && row.entity_type === 'shared_expense') {
    markExpenseSyncStatus(row.entity_id, 'failed');
  }
}

let activeFlush: Promise<void> | null = null;
let flushAgain = false;

async function flushOnce(): Promise<'continue' | 'stop'> {
  const userId = getActiveUserId();
  if (!userId) return 'stop';
  const rows = dueRows(userId);

  for (const row of rows) {
    // Sign-out (or an account switch) while this flush is running: stop
    // immediately rather than replaying the row as the next user.
    if (getActiveUserId() !== userId) return 'stop';

    try {
      if (row.entity_type === 'shared_expense' && row.operation === 'create') {
        const { error } = await supabase.rpc('create_shared_expense', {
          p_payload: JSON.parse(row.payload),
        });
        if (error) throw error;
        supabase.functions
          .invoke('notify-debt', {
            body: { expenseId: row.entity_id, kind: 'created' },
          })
          .catch(() => {});
        markExpenseSyncStatus(row.entity_id, 'synced');
        removeRow(row.id);
      } else if (row.entity_type === 'shared_expense' && row.operation === 'update') {
        const payload = JSON.parse(row.payload);
        let { error } = await supabase.rpc('update_shared_expense', { p_payload: payload });
        if (error && /expense_not_found|expense_not_active/.test(syncErrorMessage(error))) {
          // The create never reached the server (it failed or was cancelled), or
          // an in-flight void landed first. create is idempotent and revives a
          // voided expense of the same owner.
          ({ error } = await supabase.rpc('create_shared_expense', { p_payload: payload }));
        }
        if (error) throw error;
        markExpenseSyncStatus(row.entity_id, 'synced');
        removeRow(row.id);
      } else if (row.entity_type === 'shared_expense' && row.operation === 'void') {
        const { error } = await supabase.rpc('void_shared_expense', {
          p_expense_id: row.entity_id,
        });
        if (error) throw error;
        // Only now does the local row stop being shared; clearing earlier left
        // it believing it was local while the server still charged friends.
        const reshared = db.getFirstSync<{ id: string }>(
          `SELECT id FROM sync_outbox
            WHERE entity_type = 'shared_expense' AND entity_id = ?
              AND operation IN ('create', 'update') LIMIT 1`,
          row.entity_id
        );
        if (!reshared) {
          db.runSync(
            `UPDATE expenses
                SET shared_expense_id = NULL, sync_status = 'local', updated_at = ?
              WHERE shared_expense_id = ?`,
            nowIso(),
            row.entity_id
          );
        }
        removeRow(row.id);
      } else if (row.entity_type === 'shared_settlement' && row.operation === 'settle') {
        const payload = JSON.parse(row.payload) as SettlementPayload;
        const { error } = await supabase.rpc('settle_share', {
          p_participant_id: payload.participantId,
          p_amount: payload.amount,
          p_method: payload.method,
          p_idempotency_key: payload.idempotencyKey,
        });
        if (error) throw error;
        // The server returns the original settlement for a replay, so this can
        // duplicate a push after a lost response. Settlement data itself is
        // deduped by the idempotency key.
        supabase.functions
          .invoke('notify-debt', {
            body: {
              expenseId: payload.expenseId,
              participantId: payload.participantId,
              kind: 'settled',
            },
          })
          .catch(() => {});
        removeRow(row.id);
      } else {
        // Unknown operations stay queued for a future app version.
        throw new Error(`Unsupported outbox operation: ${row.entity_type}/${row.operation}`);
      }
    } catch (err) {
      if (classifySyncError(err) === 'auth') {
        // Keep the row pending; the next sign-in/foreground will retry it.
        db.runSync(
          'UPDATE sync_outbox SET last_error = ?, updated_at = ? WHERE id = ?',
          syncErrorMessage(err).slice(0, 500),
          nowIso(),
          row.id
        );
        return 'stop';
      }
      failRow(row, err);
    }
  }

  return 'continue';
}

export function flushOutbox(): Promise<void> {
  if (!isSupabaseConfigured) return Promise.resolve();
  if (activeFlush) {
    // Never drop a request made while a flush is running.
    flushAgain = true;
    return activeFlush;
  }

  activeFlush = (async () => {
    try {
      do {
        flushAgain = false;
        const outcome = await flushOnce();
        if (outcome === 'stop') break;
      } while (flushAgain);
    } finally {
      activeFlush = null;
    }
  })();

  return activeFlush;
}

// ---------------------------------------------------------------------------
// Status / recovery
// ---------------------------------------------------------------------------

export function getSyncStatus(): SyncStatus {
  const userId = getActiveUserId();
  if (!userId) return { pending: 0, failed: 0, lastError: null };

  const counts = db.getFirstSync<{ pending: number; failed: number }>(
    `SELECT
       SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
       SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
     FROM sync_outbox
     WHERE user_id = ?`,
    userId
  );
  const last = db.getFirstSync<{ last_error: string | null }>(
    `SELECT last_error FROM sync_outbox
      WHERE user_id = ? AND status = 'failed'
      ORDER BY updated_at DESC LIMIT 1`,
    userId
  );

  return {
    pending: counts?.pending ?? 0,
    failed: counts?.failed ?? 0,
    lastError: last?.last_error ?? null,
  };
}

// Retry failed rows for the current account, adopting any legacy unowned rows.
// Returns the number of rows queued for retry.
export function retryFailedSync(): number {
  const userId = getActiveUserId();
  if (!userId) return 0;
  const result = db.runSync(
    `UPDATE sync_outbox
        SET status = 'pending',
            user_id = ?,
            attempts = 0,
            next_attempt_at = NULL,
            last_error = NULL,
            updated_at = ?
      WHERE status = 'failed'
        AND (user_id = ? OR user_id IS NULL)`,
    userId,
    nowIso(),
    userId
  );
  return result.changes;
}
