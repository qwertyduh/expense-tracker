export interface ParsedTransaction {
  amount: number | null;
  merchant: string | null;
  occurredAt: string | null; // ISO string, null if unparseable
  raw: string;
  parseSucceeded: boolean;
}

export type BankSource = 'hdfc'; // add more bank identifiers here as they're supported
