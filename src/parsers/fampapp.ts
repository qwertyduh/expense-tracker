import { ParsedTransaction } from "./types";

// Parses "FamApp by Trio" payment SMS, e.g.:
//
// "You paid Rs. 1.00 to Anushka Gupta with txn ID
// FMPU01a0a898-8cd1-7292-85f2-6cbe37fc9f3a. Not done by you? Call 080-45888881
// FamApp by Trio"
//
// The message carries no timestamp, so occurredAt is left null.

const AMOUNT_REGEX = /You\s+paid\s+Rs\.?\s?([\d,]+(?:\.\d+)?)/i;
const MERCHANT_REGEX = /to\s+([^,]+?)\s+with\s+txn\s+ID/i;
const TXN_ID_REGEX = /txn\s+ID\s+([A-Za-z0-9-]+)/i;

export function parseFamAppSms(raw: string): ParsedTransaction {
  const amountMatch = raw.match(AMOUNT_REGEX);
  const merchantMatch = raw.match(MERCHANT_REGEX);
  const txnIdMatch = raw.match(TXN_ID_REGEX);

  const amount = amountMatch
    ? parseFloat(amountMatch[1].replace(/,/g, ""))
    : null;
  const merchant = merchantMatch ? merchantMatch[1].trim() : null;

  return {
    amount,
    merchant,
    occurredAt: null,
    raw,
    parseSucceeded: amount !== null && txnIdMatch !== null,
  };
}
