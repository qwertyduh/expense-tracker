import { ParsedIncoming, ParsedTransaction } from './types';

// A message counts as an expense only when its amount is attached to a debit
// verb. Matching the number alone is not enough: balances ("Avl Bal Rs.5000"),
// incoming credits ("Rs.5000 credited"), OTP references and marketing copy all
// carry "Rs."/₹ figures, and the naked-amount patterns this replaced opened the
// app for every one of them. When in doubt the filter stays closed.
//
// Ordered amount→verb first, then verb→amount, then the GPay screen. Starting
// with amount→verb keeps "Rs.500 debited. Avl Bal Rs.5000" anchored to the 500,
// not the trailing balance.
const DEBIT_AMOUNT_PATTERNS = [
  // amount → verb: "Rs.500 debited", "INR 500 has been debited", "Rs.100 withdrawn"
  /(?:Rs\.?|INR|₹)\s?([\d,]+(?:\.\d+)?)\s*(?:has\s+been\s+|is\s+|was\s+)?(?:debited|deducted|withdrawn|charged)\b/i,
  // verb → amount: "Sent Rs.501.00", "Spent Rs.49", "You paid Rs. 1.00",
  // "Paid Rs.5", "debited by Rs.200". The gap stops at a sentence boundary so a
  // trailing balance in the next sentence can't be mistaken for the amount.
  /\b(?:Sent|Spent|You\s+paid|Paid|Debited|Deducted|Withdrawn|Charged|Transferred)\b[^.\n]{0,40}?(?:Rs\.?|INR|₹)\s?([\d,]+(?:\.\d+)?)/i,
  // GPay confirmation screen: the amount line is literally "Pay ₹1.00".
  /^Pay\s+(?:Rs\.?|INR|₹)\s?([\d,]+(?:\.\d+)?)\s*$/im,
] as const;

// Non-transactions that must stay closed even when they contain a debit verb and
// an amount: statements list many entries, and an OTP names an amount without
// being a payment.
const REJECT_PATTERNS = [
  /\botp\b|one[\s-]?time\s+password|verification\s+code|do\s+not\s+share/i,
  /mini[\s-]?statement|account\s+statement|e[\s-]?statement/i,
] as const;

// The mirror of DEBIT_AMOUNT_PATTERNS for money coming IN. Same default-deny
// gate: an amount only counts when a credit verb anchors it, so a balance, a
// debit, an OTP or a promo can never masquerade as a repayment.
const CREDIT_AMOUNT_PATTERNS = [
  // amount → verb: "Rs.5,000 credited", "INR 500 has been credited"
  /(?:Rs\.?|INR|₹)\s?([\d,]+(?:\.\d+)?)\s*(?:has\s+been\s+|is\s+|was\s+)?(?:credited|received|deposited|refunded|added)\b/i,
  // credit verb → amount: "credited with Rs.5,000"
  /\bcredited\s+with\s+(?:Rs\.?|INR|₹)\s?([\d,]+(?:\.\d+)?)/i,
  // verb → amount with a short gap: "You received Rs.500", "Received Rs. 1,200"
  /\b(?:Received|Credited|Deposited|Refunded|You\s+received)\b[^.\n]{0,40}?(?:Rs\.?|INR|₹)\s?([\d,]+(?:\.\d+)?)/i,
] as const;

// Who sent the money, for the UPI shapes ("received from Anushka Gupta"). The
// lookahead stops the name at a trailing noise word or sentence break so it
// never swallows the reference, the date or the rest of the sentence.
const SENDER_NAME_PATTERNS = [
  /\bfrom\s+([A-Za-z][A-Za-z '-]*?)(?=\s+(?:on|by|with|ref|via|to|for|at)\b|[.,;\n]|$)/i,
  /\bby\s+([A-Za-z][A-Za-z '-]*?)(?=\s+(?:on|by|with|ref|via|to|for|at)\b|[.,;\n]|$)/i,
] as const;

// A UPI id / VPA: "anushka@okhdfc", "9876543210@ybl". Used to key the alias
// cache so a raw VPA can resolve to a saved person name.
const UPI_ID_REGEX = /[A-Za-z0-9._%+-]+@[A-Za-z]{2,}/;

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
// The gate is default-deny: an amount is only claimed when a debit verb anchors
// it, so credits, balances, OTPs, statements and promos all return
// `parseSucceeded: false` and never reach the Add flow.
//
// `now` is the device clock, injectable so date resolution is testable without
// freezing time; production callers always take the default.
export function parseAnySms(raw: string, now: Date = new Date()): ParsedTransaction {
  const text = raw.trim();

  let amount: number | null = null;
  if (!REJECT_PATTERNS.some((regex) => regex.test(text))) {
    for (const regex of DEBIT_AMOUNT_PATTERNS) {
      const match = text.match(regex);
      if (match) {
        amount = parseFloat(match[1].replace(/,/g, ''));
        break;
      }
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

// The credit-side parser, for incoming money captured while the phone was
// locked. It is deliberately separate from parseAnySms: a debit and a credit
// must never be confused, and parseAnySms must keep rejecting credits outright.
//
// Default-deny in the same way: REJECT_PATTERNS short-circuit first, then an
// amount is only claimed when a credit verb anchors it. `now` is injectable so
// date resolution stays testable without freezing the clock.
export function parseIncomingSms(raw: string, now: Date = new Date()): ParsedIncoming {
  const text = raw.trim();

  let amount: number | null = null;
  if (!REJECT_PATTERNS.some((regex) => regex.test(text))) {
    for (const regex of CREDIT_AMOUNT_PATTERNS) {
      const match = text.match(regex);
      if (match) {
        amount = parseFloat(match[1].replace(/,/g, ''));
        break;
      }
    }
  }

  // "your A/c"/"your account" is the account holder, not the sender, so it must
  // never be recorded as a person.
  let senderName: string | null = null;
  for (const regex of SENDER_NAME_PATTERNS) {
    const match = text.match(regex);
    if (!match) continue;
    const candidate = match[1].trim().replace(/[.,;:'-]+$/, '').trim();
    if (candidate && !/^your\b/i.test(candidate)) {
      senderName = candidate;
      break;
    }
  }

  const upiId = text.match(UPI_ID_REGEX)?.[0] ?? null;

  return {
    amount,
    senderName,
    upiId,
    occurredAt: parseOccurredAt(text, now),
    raw: text,
    parseSucceeded: amount !== null,
    bankSource: detectBankHint(text),
  };
}
