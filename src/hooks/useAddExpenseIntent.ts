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

const KNOWN_BANKS: readonly BankSource[] = ['hdfc'];

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
    // Expected shape:
    //   expensetracker://add?bank=hdfc&data=<percent-encoded raw SMS text>
    const rawText = readQueryParam(url, 'data');
    const bank = readQueryParam(url, 'bank')?.toLowerCase();

    if (!rawText || !bank) {
      if (__DEV__) {
        console.warn(
          `[deep-link] Ignored "${url}" — expected ?bank=<bank>&data=<text>. ` +
            'Check the Shortcut is URL-encoding the message and using scheme "expensetracker".'
        );
      }
      return;
    }

    if (!KNOWN_BANKS.includes(bank as BankSource)) {
      if (__DEV__) {
        console.warn(
          `[deep-link] Unknown bank "${bank}". Known: ${KNOWN_BANKS.join(', ')}. ` +
            'Opens with the raw text and blank fields.'
        );
      }
    }

    const bankSource = bank as BankSource;
    const prefill = parseSms(bankSource, rawText);

    setIntent({ source: 'sms', bankSource, prefill, rawText });
  }

  function openManual() {
    setIntent({ source: 'manual', prefill: null });
  }

  function clear() {
    setIntent(null);
  }

  return { intent, openManual, clear };
}
