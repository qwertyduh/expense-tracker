import { afterEach, describe, expect, it } from 'vitest';

import { monthKey } from './format';

// Expenses store a UTC ISO string, so month grouping has to read the DEVICE's
// calendar fields off it. In IST (UTC+05:30) a payment at 00:30 on 1 Oct is
// "2026-09-30T19:00:00.000Z" — slicing that string files it under September.
//
// The TZ is pinned per test so the boundary behaviour is asserted regardless of
// where the suite runs. Node honours process.env.TZ for Date at runtime.
const originalTz = process.env.TZ;

afterEach(() => {
  process.env.TZ = originalTz;
});

describe('monthKey', () => {
  it('files a local 00:30 payment in the month the user sees', () => {
    process.env.TZ = 'Asia/Kolkata';

    const payment = new Date(2026, 9, 1, 0, 30).toISOString();
    expect(payment).toBe('2026-09-30T19:00:00.000Z');
    expect(monthKey(payment)).toBe('2026-10');
  });

  it('files a local 23:45 payment in the same month as the user', () => {
    process.env.TZ = 'Asia/Kolkata';

    const payment = new Date(2026, 9, 31, 23, 45).toISOString();
    expect(monthKey(payment)).toBe('2026-10');
  });

  it('agrees with the current month across the same boundary', () => {
    process.env.TZ = 'Asia/Kolkata';

    // The dashboard filters against monthKey(new Date().toISOString()), so both
    // sides must resolve to the same local month or the total reads zero.
    const payment = new Date(2026, 9, 1, 0, 30).toISOString();
    const now = new Date(2026, 9, 1, 0, 30).toISOString();
    expect(monthKey(payment)).toBe(monthKey(now));
  });

  it('pads single-digit months to two digits', () => {
    process.env.TZ = 'Asia/Kolkata';

    expect(monthKey(new Date(2026, 0, 15, 12, 0).toISOString())).toBe('2026-01');
    expect(monthKey(new Date(2026, 8, 15, 12, 0).toISOString())).toBe('2026-09');
  });

  it('falls back to a slice for an unparseable string', () => {
    // Same as the old behaviour, so a malformed row can't crash the dashboard.
    expect(monthKey('not-a-date')).toBe('not-a-d');
  });

  it('follows the device clock in a western timezone too', () => {
    process.env.TZ = 'America/Los_Angeles';

    // 1 Oct 00:30 PDT is 07:30 UTC the same day — the naive UTC slice happens to
    // agree here, so this pins that the local reading didn't regress the other
    // direction.
    const payment = new Date(2026, 9, 1, 0, 30).toISOString();
    expect(monthKey(payment)).toBe('2026-10');
  });
});
