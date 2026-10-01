import { describe, expect, it } from 'vitest';
import { parseAnySms } from '../sms';

describe('parseAnySms', () => {
  it('parses HDFC UPI format', () => {
    const raw = 'UPI: Sent Rs.501.00 From HDFC Bank A/C *1234 To Pranay On 28/08/26 Ref 123456789012';
    const result = parseAnySms(raw);
    expect(result.amount).toBe(501);
    expect(result.merchant).toBe('Pranay');
    expect(result.parseSucceeded).toBe(true);
    expect(result.bankSource).toBe('hdfc');
  });

  it('parses HDFC Card format', () => {
    const raw = 'Spent Rs.49 From HDFC Bank Card x1234 At HAIER APPLIANCES INDIA On 2026-08-10:09:17:38 Bal Rs.5000';
    const result = parseAnySms(raw);
    expect(result.amount).toBe(49);
    expect(result.merchant).toBe('HAIER APPLIANCES INDIA');
    expect(result.parseSucceeded).toBe(true);
    expect(result.bankSource).toBe('hdfc');
  });

  it('parses FamApp format', () => {
    const raw = 'You paid Rs. 1.00 to Anushka Gupta with txn ID FMPU01a0a898-8cd1-7292-85f2-6cbe37fc9f3a. Not done by you? Call 080-45888881 FamApp by Trio';
    const result = parseAnySms(raw);
    expect(result.amount).toBe(1);
    expect(result.merchant).toBe('Anushka Gupta');
    expect(result.parseSucceeded).toBe(true);
    expect(result.bankSource).toBe('fampapp');
  });

  it('parses FamApp format with multiline txn ID (user provided)', () => {
    const raw = `You paid Rs. 1.00 to Anushka Gupta with txn ID FMPU01a0c3b5-1845-780c-8f3f-2f64f8a4e72d.
Not done by you? Call 080-45888881
FamApp by Trio`;
    const result = parseAnySms(raw);
    expect(result.amount).toBe(1);
    expect(result.merchant).toBe('Anushka Gupta');
    expect(result.parseSucceeded).toBe(true);
    expect(result.bankSource).toBe('fampapp');
  });

  it('parses GPay screen text format (fallback)', () => {
    const raw = 'State Bank of India\nPay ₹1.00\nTo Pranay Bansal\nEnter your PIN';
    const result = parseAnySms(raw);
    expect(result.amount).toBe(1);
    expect(result.merchant).toBe('Pranay Bansal');
    expect(result.parseSucceeded).toBe(true);
    expect(result.bankSource).toBe('gpay');
  });

  it('extracts amount from generic Rs. pattern', () => {
    const raw = 'Random text Rs. 100 somewhere';
    const result = parseAnySms(raw);
    expect(result.amount).toBe(100);
    expect(result.merchant).toBeNull();
    expect(result.parseSucceeded).toBe(true);
    expect(result.bankSource).toBe('unknown');
  });

  it('handles comma grouped amounts', () => {
    const raw = 'You paid Rs. 1,234.50 to Big Bazaar with txn ID FMPU0123-4567-8901';
    const result = parseAnySms(raw);
    expect(result.amount).toBe(1234.5);
    expect(result.merchant).toBe('Big Bazaar');
    expect(result.parseSucceeded).toBe(true);
  });

  it('returns null amount when no pattern matches', () => {
    const raw = 'Your OTP is 123456';
    const result = parseAnySms(raw);
    expect(result.amount).toBeNull();
    expect(result.merchant).toBeNull();
    expect(result.parseSucceeded).toBe(false);
  });

  it('keeps the raw text unchanged', () => {
    const raw = 'Spent Rs.49 From HDFC Bank Card x1234 At HAIER On 2026-08-10';
    expect(parseAnySms(raw).raw).toBe(raw);
  });
});

describe('parseAnySms occurredAt', () => {
  // Injected device clock: 28 Aug 2026, 15:00 local. Expectations are built with
  // the local Date constructor so they hold in any device timezone.
  const now = new Date(2026, 7, 28, 15, 0, 0);

  it('expands the 2-digit year from the device clock (DD/MM/YY)', () => {
    const raw = 'UPI: Sent Rs.501.00 From HDFC Bank A/C *1234 To Pranay On 28/08/26 Ref 123456789012';
    expect(parseAnySms(raw, now).occurredAt).toBe(new Date(2026, 7, 28, 15, 0, 0).toISOString());
  });

  it('uses the message time-of-day when the message carries one', () => {
    const raw = 'Spent Rs.49 From HDFC Bank Card x1234 At HAIER On 2026-08-10:09:17:38 Bal Rs.5000';
    expect(parseAnySms(raw, now).occurredAt).toBe(new Date(2026, 7, 10, 9, 17, 38).toISOString());
  });

  it('accepts a message from an earlier year', () => {
    const raw = 'Spent Rs.49 At HAIER On 28/08/25';
    expect(parseAnySms(raw, now).occurredAt).toBe(new Date(2025, 7, 28, 15, 0, 0).toISOString());
  });

  it('rejects an impossible calendar date instead of rolling it over', () => {
    expect(parseAnySms('Spent Rs.49 At HAIER On 31/02/26', now).occurredAt).toBeNull();
  });

  it('rejects a date in the future (typo year, clock skew)', () => {
    expect(parseAnySms('Spent Rs.49 At HAIER On 05/09/26', now).occurredAt).toBeNull();
  });

  it('returns null when the message carries no date', () => {
    const raw = 'You paid Rs. 1.00 to Anushka Gupta with txn ID FMPU01a0a898-8cd1-7292-85f2-6cbe37fc9f3a';
    expect(parseAnySms(raw, now).occurredAt).toBeNull();
  });
});