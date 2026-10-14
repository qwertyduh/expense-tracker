// Pure date-range math for the Expenses tab filter.
//
// Mirrors lib/activity-range.ts but for the home screen's range set: the
// History "30 days" preset is deliberately absent here, replaced by an explicit
// "Last month". Bounds are resolved in the DEVICE's local calendar and handed to
// SQLite as ISO strings (expenses.occurred_at is stored as a UTC ISO timestamp).

export type ExpensePreset = 'last7' | 'thisMonth' | 'lastMonth' | 'last90' | 'all' | 'custom';

export interface ExpenseRange {
  /** Inclusive lower bound (ISO string). */
  from?: string;
  /** Inclusive upper bound (ISO string). */
  to?: string;
}

export interface ExpenseRangeSelection {
  preset: ExpensePreset;
  customFrom: Date;
  customTo: Date;
}

// Chip order on the Expenses screen.
export const EXPENSE_PRESETS: { id: ExpensePreset; label: string }[] = [
  { id: 'last7', label: '7 days' },
  { id: 'thisMonth', label: 'This month' },
  { id: 'lastMonth', label: 'Last month' },
  { id: 'last90', label: '3 months' },
  { id: 'all', label: 'All time' },
  { id: 'custom', label: 'Custom' },
];

export function presetLabel(preset: ExpensePreset): string {
  return EXPENSE_PRESETS.find((item) => item.id === preset)?.label ?? '';
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

function endOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

function daysAgo(days: number, now: Date): Date {
  const d = new Date(now);
  d.setDate(d.getDate() - days);
  return d;
}

export function expenseRange(
  { preset, customFrom, customTo }: ExpenseRangeSelection,
  now: Date = new Date()
): ExpenseRange {
  const to = endOfDay(now).toISOString();

  switch (preset) {
    case 'last7':
      return { from: startOfDay(daysAgo(6, now)).toISOString(), to };
    case 'thisMonth':
      return { from: startOfDay(new Date(now.getFullYear(), now.getMonth(), 1)).toISOString(), to };
    case 'lastMonth': {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end = new Date(now.getFullYear(), now.getMonth(), 0);
      return { from: startOfDay(start).toISOString(), to: endOfDay(end).toISOString() };
    }
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

/**
 * Number of whole days a range spans (inclusive), used to normalise totals into
 * an "average per day". An open-ended range (All time) falls back to the
 * earliest expense date, or today when there's nothing to measure.
 */
export function rangeDayCount(
  range: ExpenseRange,
  now: Date = new Date(),
  earliestExpense?: string | null
): number {
  const start = range.from
    ? startOfDay(new Date(range.from))
    : startOfDay(earliestExpense ? new Date(earliestExpense) : now);
  const end = range.to ? startOfDay(new Date(range.to)) : startOfDay(now);
  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  return Math.max(1, days);
}
