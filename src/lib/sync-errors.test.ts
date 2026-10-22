import { describe, expect, it } from 'vitest';

import {
  backoffDelayMs,
  classifySyncError,
  MAX_SYNC_ATTEMPTS,
  MAX_SYNC_BACKOFF_MS,
  outboxRowId,
  syncErrorMessage,
} from '@/lib/sync-errors';

describe('classifySyncError', () => {
  it('treats server validation failures as permanent', () => {
    for (const message of [
      'expense_locked',
      'not_friends',
      'user_not_found',
      'expense_not_found',
      'not_participant',
      'already_paid',
      'Unsupported outbox operation: shared_expense/void',
    ]) {
      expect(classifySyncError(new Error(message))).toBe('permanent');
    }
  });

  it('treats missing/expired sessions as auth failures', () => {
    for (const message of ['not_authenticated', 'JWT expired', 'Invalid JWT']) {
      expect(classifySyncError(new Error(message))).toBe('auth');
    }
  });

  it('retries transport and unknown failures', () => {
    for (const message of [
      'TypeError: Network request failed',
      'Failed to fetch',
      '503 Service Unavailable',
      'something unexpected',
    ]) {
      expect(classifySyncError(new Error(message))).toBe('transient');
    }
  });

  it('reads the message from a PostgREST-style error object', () => {
    expect(
      classifySyncError({
        message: 'expense_locked',
        code: 'P0001',
        details: null,
        hint: null,
      })
    ).toBe('permanent');
  });
});

describe('syncErrorMessage', () => {
  it('extracts the message from Error and PostgREST objects', () => {
    expect(syncErrorMessage(new Error('boom'))).toBe('boom');
    expect(syncErrorMessage({ message: 'not_friends' })).toBe('not_friends');
    expect(syncErrorMessage('raw')).toBe('raw');
  });
});

describe('backoffDelayMs', () => {
  it('doubles per attempt and caps at five minutes', () => {
    expect(backoffDelayMs(1)).toBe(2000);
    expect(backoffDelayMs(4)).toBe(16000);
    expect(backoffDelayMs(20)).toBe(MAX_SYNC_BACKOFF_MS);
  });

  it('caps attempts at eight', () => {
    expect(MAX_SYNC_ATTEMPTS).toBe(8);
  });
});

describe('outboxRowId', () => {
  it('is stable per entity and operation, so re-enqueuing replaces', () => {
    expect(outboxRowId('shared_expense', 'exp-1', 'update')).toBe(
      'shared_expense:exp-1:update'
    );
    expect(outboxRowId('shared_expense', 'exp-1', 'update')).toBe(
      outboxRowId('shared_expense', 'exp-1', 'update')
    );
    expect(outboxRowId('shared_expense', 'exp-1', 'update')).not.toBe(
      outboxRowId('shared_expense', 'exp-1', 'create')
    );
  });
});
