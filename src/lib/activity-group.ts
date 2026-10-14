// Date-section headers for the History feed.
//
// The granularity follows the selected range: a day heading for a week or less,
// calendar weeks up to ~two months, then calendar months. Labels are built off
// the DEVICE's local calendar so they match what the user sees elsewhere.

import type { ActivityRange } from './activity-range';
import { monthLabel } from './format';

export type ActivityGroupMode = 'day' | 'week' | 'month';

export interface ActivityGroup {
  key: string;
  label: string;
}

const DAY_MS = 86_400_000;

export function activityGroupMode(range: ActivityRange): ActivityGroupMode {
  if (!range.from || !range.to) return 'month';
  const days = (new Date(range.to).getTime() - new Date(range.from).getTime()) / DAY_MS;
  if (days <= 7) return 'day';
  if (days <= 60) return 'week';
  return 'month';
}

export function groupForDate(
  iso: string,
  mode: ActivityGroupMode,
  now: Date = new Date()
): ActivityGroup {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return { key: iso, label: iso };

  switch (mode) {
    case 'day':
      return { key: dayKey(date), label: dayLabel(date, now) };
    case 'week':
      return weekGroup(date, now);
    case 'month': {
      const key = `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
      return { key, label: monthLabel(key) };
    }
  }
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function ordinal(day: number): string {
  const mod100 = day % 100;
  if (mod100 >= 11 && mod100 <= 13) return 'th';
  switch (day % 10) {
    case 1:
      return 'st';
    case 2:
      return 'nd';
    case 3:
      return 'rd';
    default:
      return 'th';
  }
}

function monthName(date: Date): string {
  return date.toLocaleDateString('en-IN', { month: 'long' });
}

function monthShort(date: Date): string {
  return date.toLocaleDateString('en-IN', { month: 'short' });
}

function weekdayName(date: Date): string {
  return date.toLocaleDateString('en-IN', { weekday: 'long' });
}

// "13th October" (year added only when it isn't the current one).
function dayStamp(date: Date, now: Date): string {
  const year = date.getFullYear() === now.getFullYear() ? '' : ` ${date.getFullYear()}`;
  return `${date.getDate()}${ordinal(date.getDate())} ${monthName(date)}${year}`;
}

function dayLabel(date: Date, now: Date): string {
  const key = dayKey(date);
  if (key === dayKey(now)) return `Today ${dayStamp(date, now)}`;

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (key === dayKey(yesterday)) return `Yesterday ${dayStamp(date, now)}`;

  return `${weekdayName(date)} ${dayStamp(date, now)}`;
}

function startOfWeek(date: Date): Date {
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return monday;
}

function weekGroup(date: Date, now: Date): ActivityGroup {
  const start = startOfWeek(date);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);

  const year = start.getFullYear() === now.getFullYear() ? '' : ` ${start.getFullYear()}`;
  const endDay = `${end.getDate()}${ordinal(end.getDate())}`;
  const label =
    start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()
      ? `${start.getDate()}-${endDay} ${monthShort(end)}${year}`
      : `${start.getDate()} ${monthShort(start)} - ${endDay} ${monthShort(end)}${year}`;

  return { key: dayKey(start), label };
}
