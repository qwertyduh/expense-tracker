import { useEffect, useState } from 'react';
import * as Linking from 'expo-linking';
import { parseSms, BankSource, ParsedTransaction } from '../parsers';

export type AddExpenseIntent =
  | { source: 'manual'; prefill: null }
  | {
      source: 'sms';
      bankSource: BankSource;
      prefill: ParsedTransaction;
      rawText: string;
    };

// Wraps both manual "+ Add Expense" taps and incoming deep links into one
// shape, so the Add Expense slide flow only ever has to handle one intent
// type. Handles both cold-start (getInitialURL) and warm-start (addEventListener) links.
export function useAddExpenseIntent(): {
  intent: AddExpenseIntent | null;
  openManual: () => void;
  clear: () => void;
} {
  const [intent, setIntent] = useState<AddExpenseIntent | null>(null);

  useEffect(() => {
    // Cold start: app was launched by the deep link.
    Linking.getInitialURL().then((url) => {
      if (url) handleUrl(url);
    });

    // Warm start: app was already running when the deep link fired.
    const subscription = Linking.addEventListener('url', ({ url }) => {
      handleUrl(url);
    });

    return () => subscription.remove();
  }, []);

  function handleUrl(url: string) {
    const parsed = Linking.parse(url);
    // Expected shape: mytracker://add?bank=hdfc&data=<url-encoded raw SMS text>
    const bankSource = parsed.queryParams?.bank as BankSource | undefined;
    const rawText = parsed.queryParams?.data as string | undefined;

    if (!bankSource || !rawText) return;

    const decodedText = decodeURIComponent(rawText);
    const prefill = parseSms(bankSource, decodedText);

    setIntent({ source: 'sms', bankSource, prefill, rawText: decodedText });
  }

  function openManual() {
    setIntent({ source: 'manual', prefill: null });
  }

  function clear() {
    setIntent(null);
  }

  return { intent, openManual, clear };
}
