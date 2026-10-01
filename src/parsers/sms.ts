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

// Bank SMS dates come in two shapes, both introduced by a literal "On":
//   "On 28/08/26"              — DD/MM/YY, Indian banks, no time component
//   "On 2026-08-10:09:17:38"   — YYYY-MM-DD plus an HH:MM:SS time
// Ordered most-specific first: the ISO shape needs a 4-digit year, so it cannot
// be shadowed by DD/MM/YY, but keeping it ahead makes that self-evident.
const OCCURRED_AT_PATTERNS = [
  {
    // YYYY-MM-DD, optional HH:MM[:SS]. HDFC card messages use a bare colon
    // separator ("2026-08-10:09:17:38"), ISO uses "T", prose uses a space.
    regex: /On\s+(\d{4})-(\d{2})-(\d{2})(?:[T\s:](\d{1,2}):(\d{2})(?::(\d{2}))?)?/,
    // [year, month, day, hours, minutes, seconds]
    read: (m: RegExpMatchArray) => [ +m[1], +m[2], +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0) ],
  },
  {
    regex: /On\s+(\d{1,2})\/(\d{1,2})\/(\d{2})(?![\d/])/,
    // 2-digit year is expanded from the device clock's century, and the message
    // carries no time, so the device's current time-of-day stands in.
    read: (m: RegExpMatchArray, now: Date) => [
      Math.floor(now.getFullYear() / 100) * 100 + +m[3],
      +m[2],
      +m[1],
      now.getHours(),
      now.getMinutes(),
      now.getSeconds(),
    ],
  },
] as const;

// Resolves the payment instant from the message text, using the device clock as
// the only reference — no network involved, since the SMS carries its own date.
//
// Three deliberate choices:
// - Built with the local Date constructor, so `new Date(2026, 7, 10, 23, 55)`
//   means 23:55 in the device's zone and toISOString() lands on the correct UTC
//   moment. IST is UTC-05:30, so parsing the text as if it were UTC would shift
//   every evening payment back into the previous day.
// - A date without a time gets the device's *current* time-of-day, not 00:00.
//   The payment happened minutes ago, and midnight would push a 1st-of-month
//   payment into the previous month once monthKey() reads the UTC string.
// - Dates are validated and future-dated results rejected, because the Date
//   constructor silently rolls 31/02 over to 03/03 and a wrong year (or a phone
//   with a skewed clock) would otherwise stamp an expense in the future.
function parseOccurredAt(text: string, now: Date): string | null {
  for (const { regex, read } of OCCURRED_AT_PATTERNS) {
    const match = text.match(regex);
    if (!match) continue;

    const [year, month, day, hours, minutes, seconds] = read(match, now);
    const local = new Date(year, month - 1, day, hours, minutes, seconds);

    const isImpossible =
      local.getFullYear() !== year ||
      local.getMonth() !== month - 1 ||
      local.getDate() !== day;
    if (isImpossible) continue;

    // Allow a small clock skew, so a payment made a minute ago doesn't get
    // dropped by a device running a few seconds behind.
    const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;
    if (local.getTime() > now.getTime() + FUTURE_TOLERANCE_MS) continue;

    return local.toISOString();
  }

  return null;
}

// The single parser for every bank SMS, and for the GPay screen dump arriving
// over the same deep link (both shapes are covered by the pattern lists above).
//
// `now` is the device clock, injectable so date resolution is testable without
// freezing time; production callers always take the default.
export function parseAnySms(raw: string, now: Date = new Date()): ParsedTransaction {
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
    occurredAt: parseOccurredAt(text, now),
    raw: text,
    parseSucceeded: amount !== null,
    bankSource: detectBankHint(text),
  };
}