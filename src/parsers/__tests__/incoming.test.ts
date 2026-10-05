import { describe, expect, it } from 'vitest';
import { parseAnySms, parseIncomingSms } from '../sms';

describe('parseIncomingSms', () => {
  it('parses credits anchored by a credit verb', () => {
    const cases: [string, number, string | null][] = [
      ['Rs.5,000 credited to your A/c', 5000, null],
      ['Your A/c XX1234 has been credited with Rs.5,000', 5000, null],
      ['Rs.500 received from Anushka Gupta', 500, 'Anushka Gupta'],
      ['You received Rs.500 from Anushka Gupta on 28/08/26', 500, 'Anushka Gupta'],
      ['Received Rs. 1,200 from Rohan by UPI', 1200, 'Rohan'],
      ['Credited with Rs 250', 250, null],
    ];

    for (const [raw, amount, senderName] of cases) {
      const result = parseIncomingSms(raw);
      expect(result.amount, raw).toBe(amount);
      expect(result.senderName, raw).toBe(senderName);
      expect(result.parseSucceeded, raw).toBe(true);
    }
  });

  it('rejects debits, balances, OTPs, promos and statements', () => {
    const rejected = [
      'Rs.500 debited from your A/c',
      'Avl Bal Rs.12,345.67',
      '123456 is your OTP for txn of Rs.500. Do not share it.',
      'Get Rs.500 cashback on your next purchase',
      'Mini statement: Rs.500 debited, Rs.200 credited',
    ];

    for (const raw of rejected) {
      const result = parseIncomingSms(raw);
      expect(result.amount, raw).toBeNull();
      expect(result.parseSucceeded, raw).toBe(false);
    }
  });

  it('never records the account holder as the sender', () => {
    const result = parseIncomingSms('Your A/c XX1234 has been credited with Rs.5,000');
    expect(result.senderName).toBeNull();
  });

  it('keeps the raw text unchanged and tags the bank', () => {
    const raw = 'Rs.5,000 credited to your HDFC A/c';
    const result = parseIncomingSms(raw);
    expect(result.raw).toBe(raw);
    expect(result.bankSource).toBe('hdfc');
  });

  it('resolves the occurred-at date when the message carries one', () => {
    const now = new Date(2026, 7, 28, 15, 0, 0);
    const result = parseIncomingSms('Rs.500 received from Anushka Gupta On 28/08/26', now);
    expect(result.occurredAt).toBe(new Date(2026, 7, 28, 15, 0, 0).toISOString());
  });
});

// parseAnySms sits on the debit side of the gate. The credit-side parser must
// not have loosened it: a credit is still not an expense.
describe('parseAnySms still rejects credits', () => {
  it('leaves credit strings unparsed', () => {
    const credits = [
      'Rs.5,000 credited to your A/c',
      'Your A/c XX1234 has been credited with Rs.5,000',
      'Rs.500 received from Anushka Gupta',
      'You received Rs.500 from Anushka Gupta on 28/08/26',
    ];

    for (const raw of credits) {
      const result = parseAnySms(raw);
      expect(result.amount, raw).toBeNull();
      expect(result.parseSucceeded, raw).toBe(false);
    }
  });
});
