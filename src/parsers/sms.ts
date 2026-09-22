import { ParsedTransaction } from './types';

const AMOUNT_PATTERNS = [
  /Sent\s+Rs\.?\s?([\d,]+\.?\d*)/i,
  /Spent\s+Rs\.?\s?([\d,]+\.?\d*)/i,
  /You\s+paid\s+Rs\.?\s?([\d,]+\.?\d*)/i,
  /Paid\s+Rs\.?\s?([\d,]+\.?\d*)/i,
  /Rs\.?\s?([\d,]+\.?\d*)/i,
  /₹\s?([\d,]+\.?\d*)/i,
] as const;

const MERCHANT_PATTERNS = [
  /To\s+([^\n,]+?)\s+with\s+txn\s+ID/i,
  /To\s+([^\n]+?)\s+(?:\n\s*)?On/i,
  /At\s+(.+?)\s+On\s+\d/i,
  /^To\s+(.+)$/mi,
] as const;

function detectBankHint(text: string): string {
  if (/HDFC/i.test(text)) return 'hdfc';
  if (/FamApp|FamPay/i.test(text)) return 'fampapp';
  if (/GPay|Google Pay|Pay ₹/i.test(text)) return 'gpay';
  return 'unknown';
}

export function parseAnySms(raw: string): ParsedTransaction {
  const text = raw.trim();

  let amount: number | null = null;
  for (const regex of AMOUNT_PATTERNS) {
    const match = text.match(regex);
    if (match) {
      amount = parseFloat(match[1].replace(/,/g, ''));
      break;
    }
  }

  let merchant: string | null = null;
  for (const regex of MERCHANT_PATTERNS) {
    const match = text.match(regex);
    if (match) {
      merchant = match[1].trim();
      break;
    }
  }

  return {
    amount,
    merchant,
    occurredAt: null,
    raw: text,
    parseSucceeded: amount !== null,
    bankSource: detectBankHint(text),
  };
}