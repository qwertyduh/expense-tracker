import { afterEach, describe, expect, it } from 'vitest';

import { activityRange } from './activity-range';

// Range bounds are resolved against the DEVICE's local calendar, so the TZ is
// pinned and `now` is passed explicitly to keep these assertions deterministic.
const originalTz = process.env.TZ;

afterEach(() => {
  process.env.TZ = originalTz;
});

const now = new Date(2026, 9, 14, 12, 0); // 14 Oct 2026, local noon

describe('activityRange', () => {
  it('spans the last 7 local days by default', () => {
    process.env.TZ = 'Asia/Kolkata';

    const range = activityRange({ preset: 'last7', customFrom: now, customTo: now }, now);

    expect(range.from).toBe(new Date(2026, 9, 8).toISOString());
    expect(range.to).toBe(new Date(2026, 9, 14, 23, 59, 59, 999).toISOString());
  });

  it('spans 30 days for the last-30 preset', () => {
    process.env.TZ = 'Asia/Kolkata';

    const range = activityRange({ preset: 'last30', customFrom: now, customTo: now }, now);
    expect(range.from).toBe(new Date(2026, 8, 15).toISOString());
  });

  it('starts at the first of the month for this-month', () => {
    process.env.TZ = 'Asia/Kolkata';

    const range = activityRange({ preset: 'thisMonth', customFrom: now, customTo: now }, now);
    expect(range.from).toBe(new Date(2026, 9, 1).toISOString());
  });

  it('leaves both bounds open for all-time', () => {
    process.env.TZ = 'Asia/Kolkata';

    expect(activityRange({ preset: 'all', customFrom: now, customTo: now }, now)).toEqual({});
  });

  it('covers the full custom day range inclusively', () => {
    process.env.TZ = 'Asia/Kolkata';

    const range = activityRange(
      { preset: 'custom', customFrom: new Date(2026, 9, 10), customTo: new Date(2026, 9, 20) },
      now
    );

    expect(range.from).toBe(new Date(2026, 9, 10).toISOString());
    expect(range.to).toBe(new Date(2026, 9, 20, 23, 59, 59, 999).toISOString());
  });

  it('normalizes a reversed custom selection', () => {
    process.env.TZ = 'Asia/Kolkata';

    const range = activityRange(
      { preset: 'custom', customFrom: new Date(2026, 9, 20), customTo: new Date(2026, 9, 10) },
      now
    );

    expect(range.from).toBe(new Date(2026, 9, 10).toISOString());
    expect(range.to).toBe(new Date(2026, 9, 20, 23, 59, 59, 999).toISOString());
  });
});
