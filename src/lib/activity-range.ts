// Pure date-range math for the History tab filter.
//
// Bounds are resolved in the DEVICE's local calendar so "last 7 days" matches
// what the user sees on their own clock, then handed to SQLite as ISO strings
// (activity_log.occurred_at is stored as a UTC ISO timestamp).

export type ActivityPreset = 'last7' | 'last30' | 'thisMonth' | 'last90' | 'all' | 'custom';

export interface ActivityRange {
  /** Inclusive lower bound (ISO string). */
  from?: string;
  /** Inclusive upper bound (ISO string). */
  to?: string;
}

export interface ActivityRangeSelection {
  preset: ActivityPreset;
  customFrom: Date;
  customTo: Date;
}

// Chip order on the History screen.
export const ACTIVITY_PRESETS: { id: ActivityPreset; label: string }[] = [
  { id: 'last7', label: '7 days' },
  { id: 'last30', label: '30 days' },
  { id: 'thisMonth', label: 'This month' },
  { id: 'last90', label: '3 months' },
  { id: 'all', label: 'All time' },
  { id: 'custom', label: 'Custom' },
];

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

export function endOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

function daysAgo(days: number, now: Date): Date {
  const d = new Date(now);
  d.setDate(d.getDate() - days);
  return d;
}

export function activityRange(
  { preset, customFrom, customTo }: ActivityRangeSelection,
  now: Date = new Date()
): ActivityRange {
  const to = endOfDay(now).toISOString();

  switch (preset) {
    case 'last7':
      return { from: startOfDay(daysAgo(6, now)).toISOString(), to };
    case 'last30':
      return { from: startOfDay(daysAgo(29, now)).toISOString(), to };
    case 'thisMonth':
      return { from: startOfDay(new Date(now.getFullYear(), now.getMonth(), 1)).toISOString(), to };
    case 'last90':
      return { from: startOfDay(daysAgo(89, now)).toISOString(), to };
    case 'all':
      return {};
    case 'custom': {
      // Tolerate a reversed selection rather than producing an empty range.
      const [lo, hi] = customFrom <= customTo ? [customFrom, customTo] : [customTo, customFrom];
      return { from: startOfDay(lo).toISOString(), to: endOfDay(hi).toISOString() };
    }
  }
}
