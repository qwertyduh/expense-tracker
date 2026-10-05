import { useEffect, useState } from 'react';

import { ParsedIncoming } from '@/parsers';

// What opened the /receive (incoming money) flow:
// - 'sms': a credit SMS was cached as an incoming_receipt; the flow reviews it,
//   pre-filled with the parsed amount/sender.
// - 'expense': the user tapped "Record repayment" on an expense detail screen;
//   the flow opens with that expense pre-selected.
// A null intent means /receive was opened directly (e.g. the Home "review"
// banner): it works whatever pending receipts exist, or a fresh manual entry.
export type ReceiveIntent =
  | { source: 'sms'; receiptId: string; prefill: ParsedIncoming; rawText: string }
  | { source: 'expense'; expenseId: string };

// Module-level singleton, mirroring useAddExpenseIntent: the App Intent
// dispatcher and any screen can set it, and the root provider reacts to route
// to /receive without the setter needing router access.
let receiveIntentState: ReceiveIntent | null = null;
const listeners = new Set<(intent: ReceiveIntent | null) => void>();

function notifyListeners() {
  listeners.forEach((listener) => listener(receiveIntentState));
}

export function setReceiveIntent(intent: ReceiveIntent): void {
  receiveIntentState = intent;
  notifyListeners();
}

export function clearReceiveIntent(): void {
  receiveIntentState = null;
  notifyListeners();
}

export function useReceiveIntent(): {
  intent: ReceiveIntent | null;
  clear: () => void;
} {
  const [intent, setIntent] = useState<ReceiveIntent | null>(receiveIntentState);

  useEffect(() => {
    listeners.add(setIntent);
    return () => {
      listeners.delete(setIntent);
    };
  }, []);

  return { intent, clear: clearReceiveIntent };
}
