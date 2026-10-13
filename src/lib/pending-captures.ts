import { getUnsortedCategory } from '@/db/categories';
import { insertExpense } from '@/db/expenses';
import { getMerchantMemory } from '@/db/merchant-memory';
import { db } from '@/db/schema';
import { parseAnySms } from '@/parsers';
import { notifyExpensesChanged } from '@/lib/expenses-changed';
import { liveActivity } from '@/lib/live-activity';

// App Intent delivery is at-least-once, so the same Save (or a race between Save and
// the ignore flush) can reach `autoSaveCapture` twice. Dedupe within a short window,
// both in memory and against the DB so it survives a relaunch mid-delivery.
const DEDUPE_WINDOW_MS = 2 * 60 * 1000;
const recentSaves = new Map<string, number>();

/** 'saved' = written or already present; 'skipped' = never loggable; 'retry' = keep it. */
export type SaveOutcome = 'saved' | 'skipped' | 'retry';

/**
 * Writes one SMS capture straight to the database, with no review step: the
 * remembered category when the vendor is known, else "Unsorted".
 *
 * Callers must only drop the pending capture when this does not return 'retry', so a
 * transient failure (DB/lookup) can't lose the expense.
 */
export function autoSaveCapture(rawText: string): SaveOutcome {
  const text = rawText.trim();
  if (!text) return 'skipped';

  const prefill = parseAnySms(text);
  if (!prefill.parseSucceeded || prefill.amount == null) {
    // Not an expense we can ever log; don't retry it forever.
    return 'skipped';
  }

  const now = Date.now();
  const lastInMemory = recentSaves.get(text);
  if (lastInMemory != null && now - lastInMemory < DEDUPE_WINDOW_MS) {
    return 'saved';
  }

  try {
    const since = new Date(now - DEDUPE_WINDOW_MS).toISOString();
    const existing = db.getFirstSync<{ id: string }>(
      `SELECT id FROM expenses
       WHERE raw_sms_text = ? AND source = 'sms' AND created_at > ?
       LIMIT 1`,
      text,
      since
    );
    if (existing) {
      recentSaves.set(text, now);
      return 'saved';
    }

    const memory = prefill.merchant ? getMerchantMemory(prefill.merchant) : null;
    const category = memory?.category ?? getUnsortedCategory();
    if (!category) return 'retry';

    insertExpense({
      totalAmount: prefill.amount,
      selfShare: prefill.amount,
      categoryId: category.id,
      label: null,
      merchant: prefill.merchant,
      source: 'sms',
      bankSource: prefill.bankSource ?? null,
      rawSmsText: text,
      occurredAt: prefill.occurredAt ?? new Date().toISOString(),
    });
    recentSaves.set(text, now);
    // Let any mounted expense list refresh in place.
    notifyExpensesChanged();
    return 'saved';
  } catch {
    // Leave it pending so the next foreground can try again.
    return 'retry';
  }
}

/**
 * Logs any capsule the user ignored or dismissed, then dismisses the capsules.
 *
 * There is no iOS callback when a Live Activity is swiped away or expires, so this
 * runs before the tree renders on a cold start and on every return to the
 * foreground: a capture the user never tapped Edit or Save on is written here instead
 * of being lost. Captures the user acted on were already removed from the pending
 * list. Synchronous, so a cold start's first data read already includes the expense.
 *
 * Returns how many expenses were written.
 */
export function flushPendingCaptures(): number {
  if (!liveActivity.available) return 0;

  let saved = 0;
  for (const text of liveActivity.getPendingCaptures()) {
    const outcome = autoSaveCapture(text);
    if (outcome === 'retry') {
      // Transient failure — keep it pending for the next foreground.
      continue;
    }
    // 'saved' or 'skipped': nothing more to do with it.
    if (outcome === 'saved') saved += 1;
    liveActivity.removePendingCapture(text);
  }

  if (saved > 0) {
    void liveActivity.endAll();
  }
  return saved;
}
