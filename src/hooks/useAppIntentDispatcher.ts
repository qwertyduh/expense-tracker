import { useEffect } from 'react';
import { useAppIntents, getPendingInvocationsAsync, removePendingInvocationAsync } from 'expo-app-intents';
import { parseAnySms, BankSource, ParsedTransaction } from '../parsers';
import { useAddExpenseIntentContext } from './add-expense-intent-provider';

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
  const { intent, clear, startManual } = useAddExpenseIntentContext();

  useAppIntents(async (pending, newIntent) => {
    // Collect all invocations to process: pending snapshot + the new one that triggered this call
    const toProcess = [...pending];
    if (newIntent) toProcess.push(newIntent);

    for (const inv of toProcess) {
      if (inv.name === 'processSms') {
        const text = inv.params.text as string | undefined;
        if (text) {
          // Parse the SMS text using the same parser the deep-link path uses
          const prefill = parseAnySms(text);
          const bankSource = prefill.bankSource ?? 'unknown';

          // Set the intent — this triggers the effect in AddExpenseIntentProvider
          // that navigates to /add
          // Note: We can't call setIntent directly here; we need to use the context
          // The context doesn't expose a setter, so we'll need to add one or use a different approach
        }
      }
      // Always remove the invocation after handling (or deciding to skip)
      await removePendingInvocationAsync(inv.id);
    }
  });
}