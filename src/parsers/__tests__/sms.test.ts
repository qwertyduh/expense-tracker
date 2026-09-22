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