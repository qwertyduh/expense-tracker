import { ParsedTransaction } from './types';

// TODO: replace with real regexes once we have actual HDFC UPI debit SMS
// samples. Do not guess format details — HDFC's exact wording/field order
// needs to be confirmed against real messages before this ships.
//
// Placeholder pattern based on a typical HDFC UPI debit SMS shape:
// "Rs.250.00 debited from a/c **1234 on 30-08-26 to VPA merchant@bank Ref No 123456789"
const AMOUNT_REGEX = /Rs\.?\s?([\d,]+\.?\d*)\s+debited/i;
const MERCHANT_REGEX = /to\s+VPA\s+([^\s]+)/i;
const DATE_REGEX = /on\s+(\d{2}-\d{2}-\d{2})/i;

export function parseHdfcSms(raw: string): ParsedTransaction {
  const amountMatch = raw.match(AMOUNT_REGEX);
  const merchantMatch = raw.match(MERCHANT_REGEX);
  const dateMatch = raw.match(DATE_REGEX);

  const amount = amountMatch ? parseFloat(amountMatch[1].replace(/,/g, '')) : null;
  const merchant = merchantMatch ? merchantMatch[1] : null;

  let occurredAt: string | null = null;
  if (dateMatch) {
    const [dd, mm, yy] = dateMatch[1].split('-');
    // Assumes 20YY; adjust if HDFC's date format differs from sample data.
    occurredAt = new Date(`20${yy}-${mm}-${dd}`).toISOString();
  }

  const parseSucceeded = amount !== null;

  return { amount, merchant, occurredAt, raw, parseSucceeded };
}
