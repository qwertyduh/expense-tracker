export interface ParsedTransaction {
  amount: number | null;
  merchant: string | null;
  occurredAt: string | null; // ISO string, null if unparseable
  raw: string;
  parseSucceeded: boolean;
}

// 'hdfc' is a bank SMS source; 'gpay' is a UPI-app screen source (captured by
// the Accessibility Service). Both funnel into the same parsed-transaction shape.
export type BankSource = 'hdfc' | 'gpay';
