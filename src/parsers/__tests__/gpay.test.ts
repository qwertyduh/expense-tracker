import { describe, expect, it } from 'vitest';

import { parseGpay } from '../gpay';

const PIN_SCREEN = `State Bank of India
Masked Account Number
Pay ₹1.00
To Pranay Bansal
Enter your PIN
Never enter your UPI PIN to receive money`;

describe('parseGpay', () => {
  it('extracts amount and payee from the PIN screen', () => {
    const result = parseGpay(PIN_SCREEN);
    expect(result.amount).toBe(1);
    expect(result.merchant).toBe('Pranay Bansal');
    expect(result.parseSucceeded).toBe(true);
  });

  it('handles comma-grouped amounts', () => {
    const result = parseGpay('Pay ₹1,234.50\nTo Big Bazaar\nEnter your PIN');
    expect(result.amount).toBe(1234.5);
  });

  it('matches the payee line case-insensitively', () => {
    const result = parseGpay('Pay ₹20\nto swiggy\nEnter your PIN');
    expect(result.merchant).toBe('swiggy');
  });

  it('returns a null amount but still reads the payee when no amount is present', () => {
    const result = parseGpay('Enter your PIN\nTo Someone');
    expect(result.amount).toBeNull();
    expect(result.merchant).toBe('Someone');
    expect(result.parseSucceeded).toBe(false);
  });

  it('returns a null payee when there is no "To" line', () => {
    const result = parseGpay('Pay ₹5.00\nEnter your PIN');
    expect(result.amount).toBe(5);
    expect(result.merchant).toBeNull();
  });

  it('keeps the raw text unchanged', () => {
    expect(parseGpay(PIN_SCREEN).raw).toBe(PIN_SCREEN);
  });
});
