import { describe, expect, it } from 'vitest';

import { parseHdfcSms } from '../hdfc';

const UPI = `UPI:
Sent Rs.501.00
From HDFC Bank A/C *1234
To Pranay Bansal
On 28/08/26
Ref 123456789012
Not You?
Call 18002586161/SMS BLOCK UPI to 7308080808`;

const CARD = `Spent Rs.49 From HDFC Bank Card x1234 At HAIER APPLIANCES INDIA On 2026-08-10:09:17:38 Bal Rs.5000 Not You? Call 18002586161/SMS BLOCK DC 4154 to 7308080808`;

describe('parseHdfcSms', () => {
  it('parses UPI messages (amount, payee, date)', () => {
    const result = parseHdfcSms(UPI);
    expect(result.amount).toBe(501);
    expect(result.merchant).toBe('Pranay Bansal');
    expect(result.parseSucceeded).toBe(true);
    expect(result.occurredAt?.startsWith('2026-08-28')).toBe(true);
  });

  it('parses card messages (amount, merchant, date)', () => {
    const result = parseHdfcSms(CARD);
    expect(result.amount).toBe(49);
    expect(result.merchant).toBe('HAIER APPLIANCES INDIA');
    expect(result.parseSucceeded).toBe(true);
    expect(result.occurredAt?.startsWith('2026-08-10')).toBe(true);
  });

  it('handles comma-grouped amounts', () => {
    const result = parseHdfcSms(
      'UPI:\nSent Rs.1,234.00\nFrom HDFC Bank A/C *1234\nTo X\nOn 01/09/26'
    );
    expect(result.amount).toBe(1234);
  });

  it('falls back to raw text for unknown formats', () => {
    const result = parseHdfcSms('Your OTP is 123456');
    expect(result.amount).toBeNull();
    expect(result.merchant).toBeNull();
    expect(result.parseSucceeded).toBe(false);
    expect(result.raw).toBe('Your OTP is 123456');
  });
});
