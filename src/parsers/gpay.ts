import { ParsedTransaction } from './types';

// Parses the GPay "Enter your PIN" confirmation screen text as captured by the
// Android Accessibility Service (see PaymentAccessibilityService.kt). The
// service joins every visible label into one newline-joined string, e.g.:
//
//   State Bank of India
//   Masked Account Number
//   Pay ₹1.00
//   To Pranay Bansal
//   Enter your PIN
//   Never enter your UPI PIN to receive money
//
// (The success screen itself is FLAG_SECURE and unreadable, so we parse the
// pre-payment confirmation screen instead — amount and recipient are identical.)

const AMOUNT_REGEX = /₹\s?([\d,]+(?:\.\d+)?)/;
const MERCHANT_REGEX = /^to\s+(.+)$/mi;

export function parseGpay(raw: string): ParsedTransaction {
  const amountMatch = raw.match(AMOUNT_REGEX);
  const merchantMatch = raw.match(MERCHANT_REGEX);

  const amount = amountMatch ? parseFloat(amountMatch[1].replace(/,/g, '')) : null;
  const merchant = merchantMatch ? merchantMatch[1].trim() : null;

  return {
    amount,
    merchant,
    occurredAt: null,
    raw,
    parseSucceeded: amount !== null,
  };
}
