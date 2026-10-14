import { db } from './schema';
import type { ActivityRange } from '@/lib/activity-range';

export interface ActivityRow {
  id: string;
  action: 'created' | 'edited' | 'deleted';
  expense_id: string;
  expense_snapshot: string;
  occurred_at: string;
  created_at: string;
}

export interface ListActivityOptions {
  limit?: number;
  range?: ActivityRange;
}

// Reverse-chronological feed for the History tab. Independent of the live
// expenses table, so deleted expenses still appear here. `range` bounds are
// inclusive ISO timestamps on the log's own `occurred_at` (the event time,
// not the expense's date).
export function listActivity({ limit = 100, range }: ListActivityOptions = {}): ActivityRow[] {
  const clauses: string[] = [];
  const params: (string | number)[] = [];

  if (range?.from) {
    clauses.push('occurred_at >= ?');
    params.push(range.from);
  }
  if (range?.to) {
    clauses.push('occurred_at <= ?');
    params.push(range.to);
  }

  const where = clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '';
  params.push(limit);

  return db.getAllSync<ActivityRow>(
    `SELECT * FROM activity_log${where} ORDER BY occurred_at DESC, created_at DESC LIMIT ?`,
    ...params
  );
}
