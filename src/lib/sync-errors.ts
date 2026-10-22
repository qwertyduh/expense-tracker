// Classification of sync/outbox failures.
//
// Permanent failures will never succeed by retrying (the server rejected the
// payload), so they are surfaced instead of being retried forever. Auth
// failures are paused until the next sign-in/foreground. Everything else is
// treated as a transient transport problem and retried with backoff.

export const MAX_SYNC_ATTEMPTS = 8;
export const MAX_SYNC_BACKOFF_MS = 5 * 60 * 1000;

export type SyncErrorKind = 'permanent' | 'transient' | 'auth';

// Messages come from the PostgreSQL RPCs in supabase/migrations. Keep these as
// substrings of the lowercased error text.
const PERMANENT_ERRORS = [
  'expense_locked',
  'not_friends',
  'user_not_found',
  'cannot_split_with_self',
  'invalid_share',
  'invalid_total',
  'invalid_owner_share',
  'missing_expense_id',
  'expense_not_found',
  'expense_not_active',
  'not_owner',
  'not_participant',
  'not_payer',
  'participant_not_found',
  'already_paid',
  'share_disputed',
  'cannot_add_self',
  'reserved_username',
  'invalid_username',
  'unsupported outbox operation',
];

const AUTH_ERRORS = [
  'not_authenticated',
  'jwt expired',
  'invalid jwt',
  'invalid claim',
  'unauthorized',
];

export function syncErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return String(error);
}

export function classifySyncError(error: unknown): SyncErrorKind {
  const message = syncErrorMessage(error).toLowerCase();
  if (AUTH_ERRORS.some((needle) => message.includes(needle))) return 'auth';
  if (PERMANENT_ERRORS.some((needle) => message.includes(needle))) return 'permanent';
  return 'transient';
}

export function backoffDelayMs(attempts: number): number {
  return Math.min(MAX_SYNC_BACKOFF_MS, 2 ** attempts * 1000);
}

// One outbox row per entity + operation. Re-enqueuing replaces the payload
// instead of appending another row for every edit.
export function outboxRowId(entityType: string, entityId: string, operation: string): string {
  return `${entityType}:${entityId}:${operation}`;
}
