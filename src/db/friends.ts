import { db } from './schema';

export type CachedFriend = {
  userId: string;
  username: string;
  displayName: string;
  status: 'pending' | 'accepted' | 'declined' | 'blocked';
  direction: 'incoming' | 'outgoing' | null;
  friendshipId: string | null;
};

export function replaceFriendCache(rows: CachedFriend[]): void {
  const now = new Date().toISOString();
  db.withTransactionSync(() => {
    db.runSync('DELETE FROM friend_cache');
    for (const row of rows) {
      db.runSync(
        `INSERT INTO friend_cache
           (user_id, username, display_name, status, direction, friendship_id, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        row.userId,
        row.username,
        row.displayName,
        row.status,
        row.direction,
        row.friendshipId,
        now
      );
    }
  });
}

export function listCachedFriends(): CachedFriend[] {
  return db
    .getAllSync<{
      user_id: string;
      username: string;
      display_name: string;
      status: CachedFriend['status'];
      direction: CachedFriend['direction'];
      friendship_id: string | null;
    }>('SELECT * FROM friend_cache ORDER BY display_name ASC')
    .map((row) => ({
      userId: row.user_id,
      username: row.username,
      displayName: row.display_name,
      status: row.status,
      direction: row.direction,
      friendshipId: row.friendship_id,
    }));
}

export function listCachedAcceptedFriends(): CachedFriend[] {
  return listCachedFriends().filter((row) => row.status === 'accepted');
}

// Account-scoped data: cleared on sign-out so the next account never sees the
// previous user's friends (including pending requests).
export function clearFriendCache(): void {
  db.runSync('DELETE FROM friend_cache');
}
