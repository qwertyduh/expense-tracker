import { ParsedTransaction } from './types';

// Built from real HDFC SMS samples. Two known message shapes for this bank:
//
// UPI:
// "UPI:
// Sent Rs.501.00
// From HDFC Bank A/C *1234
// To {name}
// On 28/08/26
// Ref 123456789012
// Not You?
// Call 18002586161/SMS BLOCK UPI to 7308080808"
//
// Card:
// "Spent Rs.49 From HDFC Bank Card x1234 At HAIER APPLIANCES INDIA On
// 2026-08-10:09:17:38 Bal Rs.{num} Not You? Call 18002586161/SMS BLOCK DC
// 4154 to 7308080808"

const UPI_AMOUNT_REGEX = /Sent\s+Rs\.?\s?([\d,]+\.?\d*)/i;
const UPI_MERCHANT_REGEX = /To\s+([^\n]+?)\s*\n\s*On/i;
const UPI_DATE_REGEX = /On\s+(\d{2})\/(\d{2})\/(\d{2})/i;

const CARD_AMOUNT_REGEX = /Spent\s+Rs\.?\s?([\d,]+\.?\d*)/i;
const CARD_MERCHANT_REGEX = /At\s+(.+?)\s+On\s+\d/i;
const CARD_DATE_REGEX = /On\s+(\d{4})-(\d{2})-(\d{2}):(\d{2}):(\d{2}):(\d{2})/i;

function parseUpi(raw: string): ParsedTransaction {
  const amountMatch = raw.match(UPI_AMOUNT_REGEX);
  const merchantMatch = raw.match(UPI_MERCHANT_REGEX);
  const dateMatch = raw.match(UPI_DATE_REGEX);

  const amount = amountMatch ? parseFloat(amountMatch[1].replace(/,/g, '')) : null;
  const merchant = merchantMatch ? merchantMatch[1].trim() : null;

  let occurredAt: string | null = null;
  if (dateMatch) {
    const [, dd, mm, yy] = dateMatch;
    occurredAt = new Date(`20${yy}-${mm}-${dd}`).toISOString();
  }

  return { amount, merchant, occurredAt, raw, parseSucceeded: amount !== null };
}

function parseCard(raw: string): ParsedTransaction {
  const amountMatch = raw.match(CARD_AMOUNT_REGEX);
  const merchantMatch = raw.match(CARD_MERCHANT_REGEX);
  const dateMatch = raw.match(CARD_DATE_REGEX);

  const amount = amountMatch ? parseFloat(amountMatch[1].replace(/,/g, '')) : null;
  const merchant = merchantMatch ? merchantMatch[1].trim() : null;

  let occurredAt: string | null = null;
  if (dateMatch) {
    const [, yyyy, mm, dd, hh, min, ss] = dateMatch;
    occurredAt = new Date(`${yyyy}-${mm}-${dd}T${hh}:${min}:${ss}`).toISOString();
  }

  return { amount, merchant, occurredAt, raw, parseSucceeded: amount !== null };
}

export function parseHdfcSms(raw: string): ParsedTransaction {
  const trimmed = raw.trim();

  // UPI messages start with "UPI:" and use "Sent Rs...From HDFC Bank A/C".
  if (/^UPI:/i.test(trimmed) || /Sent\s+Rs.*From\s+HDFC\s+Bank\s+A\/C/is.test(trimmed)) {
    return parseUpi(trimmed);
  }

  // Card messages use "Spent Rs...From HDFC Bank Card".
  if (/Spent\s+Rs.*From\s+HDFC\s+Bank\s+Card/is.test(trimmed)) {
    return parseCard(trimmed);
  }

  // Doesn't match either known shape — fall back to option A (raw text
  // shown, everything else left for manual entry).
  return { amount: null, merchant: null, occurredAt: null, raw: trimmed, parseSucceeded: false };
}
