import { db } from './schema';

export interface ActivityRow {
  id: string;
  action: 'created' | 'edited' | 'deleted';
  expense_id: string;
  expense_snapshot: string;
  occurred_at: string;
  created_at: string;
}

// Reverse-chronological feed for the History tab. Independent of the live
// expenses table, so deleted expenses still appear here.
export function listActivity(limit = 100): ActivityRow[] {
  return db.getAllSync<ActivityRow>(
    'SELECT * FROM activity_log ORDER BY occurred_at DESC, created_at DESC LIMIT ?',
    limit
  );
}
