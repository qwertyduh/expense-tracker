import { useAppIntents, removePendingInvocationAsync } from 'expo-app-intents';
import { parseAnySms, parseIncomingSms } from '../parsers';
import { insertIncomingReceipt } from '../db/incoming-receipts';
import { useAddExpenseIntentContext } from './add-expense-intent-provider';
import { setReceiveIntent } from './receive-intent';

/**
 * Hook that listens for App Intent invocations dispatched from the native layer
 * (via `AppIntentDispatcher.shared.dispatch(...)` in ProcessSMSIntent.perform()).
 *
 * This replaces the old deep-link listener (`useAddExpenseIntent`) for the
 * Shortcut → App Intent path. The deep-link path remains as a fallback.
 *
 * Must be called inside `AddExpenseIntentProvider` so it can access
 * `useAddExpenseIntentContext()` to set the intent and navigate.
 */
export function useAppIntentDispatcher(): void {
  const { setSmsIntent } = useAddExpenseIntentContext();

  useAppIntents(async (pending) => {
    // `pending` is the current snapshot and already includes the invocation that
    // triggered this call, so `newIntent` is redundant here — pushing it again
    // would double-handle the newest invocation.
    for (const inv of pending) {
      if (inv.name === 'processSms') {
        const text = inv.params.text as string | undefined;
        if (__DEV__) {
          console.log(
            `[app-intent] processSms received (${text?.length ?? 0} chars): ${JSON.stringify(text?.slice(0, 80))}`
          );
        }
        if (text) {
          // Parse with the same parser the deep-link path uses, and only open
          // the Add flow when a debit verb anchored an amount (a real expense) —
          // balances, credits, OTPs and promos parse to no amount.
          const prefill = parseAnySms(text);
          if (__DEV__) {
            console.log('[app-intent] parseAnySms →', {
              parseSucceeded: prefill.parseSucceeded,
              amount: prefill.amount,
              merchant: prefill.merchant,
            });
          }
          if (prefill.parseSucceeded) {
            setSmsIntent(prefill, text, prefill.bankSource ?? 'unknown');
          }
        }
      }
      if (inv.name === 'processSmsIncoming') {
        const text = inv.params.text as string | undefined;
        if (__DEV__) {
          console.log(
            `[app-intent] processSmsIncoming received (${text?.length ?? 0} chars): ${JSON.stringify(text?.slice(0, 80))}`
          );
        }
        if (text) {
          // Credit SMS captured in the background while the app was closed.
          // Cache the raw text as a pending receipt, then hand the parsed
          // prefill to the receive flow via the module-level intent.
          const prefill = parseIncomingSms(text);
          const receipt = insertIncomingReceipt({
            rawSmsText: text,
            bankSource: prefill.bankSource ?? null,
            parsedAmount: prefill.amount,
            parsedName: prefill.senderName,
            receivedAt: prefill.occurredAt ?? new Date().toISOString(),
          });
          setReceiveIntent({ source: 'sms', receiptId: receipt.id, prefill, rawText: text });
        }
      }
      // Always remove the invocation after handling (or deciding to skip)
      await removePendingInvocationAsync(inv.id);
    }
  });
}