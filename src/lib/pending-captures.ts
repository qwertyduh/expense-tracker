import { getUnsortedCategory } from '@/db/categories';
import { insertExpense } from '@/db/expenses';
import { getMerchantMemory } from '@/db/merchant-memory';
import { parseAnySms } from '@/parsers';
import { liveActivity } from '@/lib/live-activity';

/**
 * Writes one SMS capture straight to the database, with no review step: the
 * remembered category when the vendor is known, else "Unsorted". Returns whether a
 * row was written.
 */
export function autoSaveCapture(rawText: string): boolean {
  const text = rawText.trim();
  if (!text) return false;

  const prefill = parseAnySms(text);
  if (!prefill.parseSucceeded || prefill.amount == null) return false;

  const memory = prefill.merchant ? getMerchantMemory(prefill.merchant) : null;
  const category = memory?.category ?? getUnsortedCategory();
  if (!category) return false;

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
  return true;
}

/**
 * Logs any capsule the user ignored or dismissed, then dismisses the capsules.
 *
 * There is no iOS callback when a Live Activity is swiped away or expires, so this
 * runs at startup and on every return to the foreground: a capture the user never
 * tapped Edit or Save on is written here instead of being lost. Captures the user
 * acted on were already removed from the pending list.
 */
export function flushPendingCaptures(): void {
  if (!liveActivity.available) return;

  liveActivity
    .getPendingCaptures()
    .then((texts) => {
      if (texts.length === 0) return;

      let saved = 0;
      for (const text of texts) {
        if (autoSaveCapture(text)) saved += 1;
        // Drop it either way: an unparseable capture would otherwise retry forever.
        void liveActivity.removePendingCapture(text);
      }
      if (saved > 0) {
        void liveActivity.endAll();
      }
    })
    .catch(() => {
      // Best effort; the capture stays pending for the next foreground.
    });
}
