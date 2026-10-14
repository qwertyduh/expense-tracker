import { afterEach, describe, expect, it } from 'vitest';

import { activityGroupMode, groupForDate } from './activity-group';

const originalTz = process.env.TZ;

afterEach(() => {
  process.env.TZ = originalTz;
});

const now = new Date(2026, 9, 14, 12, 0); // Wed 14 Oct 2026, local noon
const iso = (y: number, m: number, d: number, h = 12) => new Date(y, m, d, h).toISOString();

describe('activityGroupMode', () => {
  it('groups by day for a week or less', () => {
    process.env.TZ = 'Asia/Kolkata';
    expect(
      activityGroupMode({ from: iso(2026, 9, 8, 0), to: iso(2026, 9, 14, 23) })
    ).toBe('day');
  });

  it('groups by week up to two months', () => {
    process.env.TZ = 'Asia/Kolkata';
    expect(
      activityGroupMode({ from: iso(2026, 8, 15, 0), to: iso(2026, 9, 14, 23) })
    ).toBe('week');
  });

  it('groups by month beyond two months', () => {
    process.env.TZ = 'Asia/Kolkata';
    expect(
      activityGroupMode({ from: iso(2026, 6, 17, 0), to: iso(2026, 9, 14, 23) })
    ).toBe('month');
  });

  it('falls back to month when a bound is open (all time)', () => {
    process.env.TZ = 'Asia/Kolkata';
    expect(activityGroupMode({})).toBe('month');
  });
});

describe('groupForDate day mode', () => {
  it('labels today and yesterday by name', () => {
    process.env.TZ = 'Asia/Kolkata';
    expect(groupForDate(iso(2026, 9, 14), 'day', now).label).toBe('Today 14th October');
    expect(groupForDate(iso(2026, 9, 13), 'day', now).label).toBe('Yesterday 13th October');
  });

  it('labels older days by weekday', () => {
    process.env.TZ = 'Asia/Kolkata';
    expect(groupForDate(iso(2026, 9, 9), 'day', now).label).toBe('Friday 9th October');
  });

  it('keys every instant of a local day together', () => {
    process.env.TZ = 'Asia/Kolkata';
    expect(groupForDate(iso(2026, 9, 13, 0), 'day', now).key).toBe(
      groupForDate(iso(2026, 9, 13, 23), 'day', now).key
    );
  });

  it('adds the year when it differs from the current one', () => {
    process.env.TZ = 'Asia/Kolkata';
    expect(groupForDate(iso(2025, 11, 31), 'day', now).label).toContain('2025');
  });
});

describe('groupForDate week mode', () => {
  it('labels a Monday-to-Sunday week within one month', () => {
    process.env.TZ = 'Asia/Kolkata';
    const group = groupForDate(iso(2026, 9, 11), 'week', now);
    expect(group.label).toBe('5-11th Oct');
    expect(group.key).toBe(groupForDate(iso(2026, 9, 8), 'week', now).key);
  });

  it('spans two months when the week crosses a boundary', () => {
    process.env.TZ = 'Asia/Kolkata';
    expect(groupForDate(iso(2026, 9, 1), 'week', now).label).toBe('28 Sept - 4th Oct');
  });
});

describe('groupForDate month mode', () => {
  it('labels by month and year', () => {
    process.env.TZ = 'Asia/Kolkata';
    const group = groupForDate(iso(2026, 9, 14), 'month', now);
    expect(group.key).toBe('2026-10');
    expect(group.label).toBe('October 2026');
  });
});

describe('groupForDate unparseable input', () => {
  it('falls back to the raw string', () => {
    expect(groupForDate('not-a-date', 'day', now)).toEqual({
      key: 'not-a-date',
      label: 'not-a-date',
    });
  });
});
