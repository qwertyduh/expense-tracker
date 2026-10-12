import { listMerchantMemory } from '@/db/merchant-memory';
import { liveActivity } from '@/lib/live-activity';

// Must mirror `normalizeMerchant` in `src/db/merchant-memory.ts` and
// `ExpenseCaptureBridge.normalize` in `app-intents/ShowExpenseCaptureIntent.swift`:
// trim, collapse whitespace, lowercase. The intent looks the vendor up by this key.
function normalizeMerchant(merchant: string): string {
  return merchant.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Push the learned vendor → category map into the native store the Live Activity
 * intent reads, so a capsule can show a category while the app is in the
 * background. Called at launch, when the app returns to the foreground, and after
 * any change to `merchant_memory`. Best effort: on failure the capsule just shows
 * "Uncategorized".
 */
export function syncMerchantCategoryMap(): void {
  if (!liveActivity.available) return;

  const map: Record<string, string> = {};
  for (const row of listMerchantMemory()) {
    if (!row.category_name) continue;
    map[normalizeMerchant(row.merchant)] = row.category_name;
  }

  liveActivity.setMerchantCategoryMap(JSON.stringify(map)).catch(() => {
    // Ignored — the capsule falls back to "Uncategorized".
  });
}
