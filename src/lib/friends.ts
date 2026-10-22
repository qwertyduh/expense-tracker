import { replaceFriendCache, type CachedFriend } from '@/db/friends';
import { supabase } from '@/lib/supabase';

export type FriendProfile = {
  id: string;
  username: string;
  display_name: string;
};

type FriendshipRow = {
  id: string;
  requester_id: string;
  addressee_id: string;
  status: 'pending' | 'accepted' | 'declined' | 'blocked';
};

export type FriendsSnapshot = {
  friends: CachedFriend[];
  incoming: CachedFriend[];
  outgoing: CachedFriend[];
};

export async function searchUser(username: string): Promise<FriendProfile | null> {
  const { data, error } = await supabase.rpc('lookup_user', {
    p_username: username.trim().toLowerCase(),
  });
  if (error) throw error;
  const rows = (data ?? []) as FriendProfile[];
  return rows[0] ?? null;
}

export async function sendFriendRequest(username: string): Promise<void> {
  const { error } = await supabase.rpc('send_friend_request', {
    p_username: username.trim().toLowerCase(),
  });
  if (error) throw error;
}

export async function respondFriendRequest(
  friendshipId: string,
  accept: boolean
): Promise<void> {
  const { error } = await supabase.rpc('respond_friend_request', {
    p_friendship_id: friendshipId,
    p_accept: accept,
  });
  if (error) throw error;
}

export async function removeFriend(userId: string): Promise<void> {
  const { error } = await supabase.rpc('remove_friend', { p_user_id: userId });
  if (error) throw error;
}

export async function loadFriends(): Promise<FriendsSnapshot> {
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;
  const userId = auth.user?.id;
  if (!userId) throw new Error('Not signed in');

  const { data, error } = await supabase
    .from('friendships')
    .select('id, requester_id, addressee_id, status')
    .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`);
  if (error) throw error;

  const links = (data ?? []) as FriendshipRow[];
  const profileIds = [
    ...new Set(links.flatMap((row) => [row.requester_id, row.addressee_id])),
  ].filter((id) => id !== userId);

  // Account switched while this load was in flight: never publish (or wipe)
  // the cache using the previous account's result.
  const stillSameUser = async () => {
    const current = await supabase.auth.getSession();
    return current.data.session?.user.id === userId;
  };

  if (profileIds.length === 0) {
    if (await stillSameUser()) replaceFriendCache([]);
    return { friends: [], incoming: [], outgoing: [] };
  }

  const { data: profiles, error: profileError } = await supabase
    .from('profiles')
    .select('id, username, display_name')
    .in('id', profileIds);
  if (profileError) throw profileError;

  if (!(await stillSameUser())) {
    return { friends: [], incoming: [], outgoing: [] };
  }

  const profilesById = new Map(
    ((profiles ?? []) as FriendProfile[]).map((profile) => [profile.id, profile])
  );

  const rows: CachedFriend[] = [];
  for (const link of links) {
    const otherId =
      link.requester_id === userId ? link.addressee_id : link.requester_id;
    const profile = profilesById.get(otherId);
    if (!profile) continue;
    rows.push({
      userId: otherId,
      username: profile.username,
      displayName: profile.display_name,
      status: link.status,
      direction:
        link.status === 'accepted'
          ? null
          : link.addressee_id === userId
            ? 'incoming'
            : 'outgoing',
      friendshipId: link.id,
    });
  }

  replaceFriendCache(rows);

  return {
    friends: rows.filter((row) => row.status === 'accepted'),
    incoming: rows.filter(
      (row) => row.status === 'pending' && row.direction === 'incoming'
    ),
    outgoing: rows.filter(
      (row) => row.status === 'pending' && row.direction === 'outgoing'
    ),
  };
}
