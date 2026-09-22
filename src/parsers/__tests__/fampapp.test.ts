import { describe, expect, it } from 'vitest';

import { parseFamAppSms } from '../fampapp';

const SMS =
  'You paid Rs. 1.00 to Anushka Gupta with txn ID FMPU01a0a898-8cd1-7292-85f2-6cbe37fc9f3a. Not done by you? Call 080-45888881 FamApp by Trio';

describe('parseFamAppSms', () => {
  it('extracts amount, payee and txn ID', () => {
    const result = parseFamAppSms(SMS);
    expect(result.amount).toBe(1);
    expect(result.merchant).toBe('Anushka Gupta');
    expect(result.parseSucceeded).toBe(true);
  });

  it('has no timestamp in the message', () => {
    const result = parseFamAppSms(SMS);
    expect(result.occurredAt).toBeNull();
  });

  it('handles comma-grouped amounts', () => {
    const result = parseFamAppSms(
      'You paid Rs. 1,234.50 to Big Bazaar with txn ID FMPU0123-4567-8901'
    );
    expect(result.amount).toBe(1234.5);
  });

  it('defaults to failure when the txn ID is missing', () => {
    const result = parseFamAppSms('You paid Rs. 100.00 to Someone');
    expect(result.amount).toBe(100);
    expect(result.parseSucceeded).toBe(false);
  });

  it('returns null fields for unknown formats', () => {
    const result = parseFamAppSms('Your OTP is 123456');
    expect(result.amount).toBeNull();
    expect(result.merchant).toBeNull();
    expect(result.parseSucceeded).toBe(false);
  });

  it('keeps the raw text unchanged', () => {
    expect(parseFamAppSms(SMS).raw).toBe(SMS);
  });
});