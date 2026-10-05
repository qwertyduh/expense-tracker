import { useEffect, useState } from 'react';
import * as Linking from 'expo-linking';
import { parseAnySms, BankSource, ParsedTransaction } from '../parsers';

export type AddExpenseIntent =
  | { source: 'manual'; prefill: null }
  | {
      source: 'sms';
      bankSource: BankSource;
      prefill: ParsedTransaction;
      rawText: string;
    };

// Reads one query param out of a raw deep link, percent-decoding it exactly once.
//
// Deliberately avoids `Linking.parse`: that decodes query values via
// URLSearchParams and then runs decodeURIComponent over the already-decoded
// result. The second pass throws `URI malformed` on any bank SMS containing a
// literal '%' ("Get 5% cashback on HDFC Bank Card..."), and because the throw
// happens inside parse(), the intent was never set — the app opened, nothing
// pre-filled, no error surfaced. Decoding once, from the raw URL, is both
// correct and exception-free.
//
// This expects the sender to percent-encode (what Shortcuts' "URL Encode" action
// produces, matching encodeURIComponent): a literal '+' is left alone, spaces
// arrive as %20. '+' is NOT treated as a space, since 'Call +919876543210'
// is real text in these messages.
function readQueryParam(url: string, key: string): string | null {
  const queryStart = url.indexOf('?');
  if (queryStart === -1) return null;

  for (const pair of url.slice(queryStart + 1).split('&')) {
    const separator = pair.indexOf('=');
    if (separator === -1 || pair.slice(0, separator) !== key) continue;

    const value = pair.slice(separator + 1);
    try {
      return decodeURIComponent(value);
    } catch {
      // Malformed percent-encoding. Hand back the raw value rather than
      // dropping the message — the Add flow still shows it for manual entry.
      return value;
    }
  }
  return null;
}

// Shared state for the intent, so both deep-link and App Intent paths can set it.
let intentState: AddExpenseIntent | null = null;
const listeners = new Set<(intent: AddExpenseIntent | null) => void>();

function notifyListeners() {
  // The listeners are React state setters; they need the current value, not a
  // no-arg call (which would set the state to undefined).
  listeners.forEach(listener => listener(intentState));
}

function setSmsIntentState(prefill: ParsedTransaction, rawText: string, bankSource?: BankSource) {
  intentState = { source: 'sms', bankSource: bankSource ?? 'unknown', prefill, rawText };
  notifyListeners();
}

function setManualIntentState() {
  intentState = { source: 'manual', prefill: null };
  notifyListeners();
}

// Wraps both manual "+ Add Expense" taps and incoming deep links into one
// shape, so the Add Expense slide flow only ever has to handle one intent
// type. Handles both cold-start (getInitialURL) and warm-start (addEventListener) links.
export function useAddExpenseIntent(): {
  intent: AddExpenseIntent | null;
  openManual: () => void;
  clear: () => void;
  setSmsIntent: (prefill: ParsedTransaction, rawText: string, bankSource: BankSource) => void;
} {
  const [intent, setIntent] = useState<AddExpenseIntent | null>(intentState);

  useEffect(() => {
    listeners.add(setIntent);
    return () => {
      listeners.delete(setIntent);
    };
  }, []);

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
    // Expected shape:
    //   expensetracker://add?data=<percent-encoded raw SMS text>
    const rawText = readQueryParam(url, 'data');

    if (!rawText) {
      if (__DEV__) {
        console.warn(
          `[deep-link] Ignored "${url}" — expected ?data=<text>. ` +
            'Check the Shortcut is URL-encoding the message and using scheme "expensetracker".'
        );
      }
      return;
    }

    const prefill = parseAnySms(rawText);
    const bankSource = prefill.bankSource ?? 'unknown';

    setSmsIntentState(prefill, rawText, bankSource);
  }

  function openManual() {
    setManualIntentState();
  }

  function clear() {
    intentState = null;
    notifyListeners();
  }

  function setSmsIntent(prefill: ParsedTransaction, rawText: string, bankSource: BankSource) {
    setSmsIntentState(prefill, rawText, bankSource);
  }

  return { intent, openManual, clear, setSmsIntent };
}
