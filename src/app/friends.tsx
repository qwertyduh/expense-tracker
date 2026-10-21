import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Screen, ScreenHeader } from '@/components/ui/screen';
import { Spacing } from '@/constants/theme';
import type { CachedFriend } from '@/db/friends';
import {
  loadFriends,
  removeFriend,
  respondFriendRequest,
  searchUser,
  sendFriendRequest,
  type FriendProfile,
} from '@/lib/friends';
import { useTheme } from '@/hooks/use-theme';

export default function FriendsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const [friends, setFriends] = useState<CachedFriend[]>([]);
  const [incoming, setIncoming] = useState<CachedFriend[]>([]);
  const [outgoing, setOutgoing] = useState<CachedFriend[]>([]);
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<FriendProfile | null>(null);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    setError(null);
    loadFriends()
      .then((snapshot) => {
        setFriends(snapshot.friends);
        setIncoming(snapshot.incoming);
        setOutgoing(snapshot.outgoing);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load friends.'));
  }, []);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload])
  );

  const search = async () => {
    const username = query.trim().toLowerCase();
    if (!username) return;
    setSearching(true);
    setError(null);
    setResult(null);
    try {
      const found = await searchUser(username);
      if (!found) setError('No account with that username.');
      setResult(found);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed.');
    } finally {
      setSearching(false);
    }
  };

  const add = async () => {
    if (!result) return;
    setBusy(true);
    try {
      await sendFriendRequest(result.username);
      setResult(null);
      setQuery('');
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send request.');
    } finally {
      setBusy(false);
    }
  };

  const respond = async (row: CachedFriend, accept: boolean) => {
    if (!row.friendshipId) return;
    setBusy(true);
    try {
      await respondFriendRequest(row.friendshipId, accept);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not respond.');
    } finally {
      setBusy(false);
    }
  };

  const remove = (row: CachedFriend) => {
    Alert.alert(`Remove @${row.username}?`, 'You will no longer be able to tag each other.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          removeFriend(row.userId)
            .then(reload)
            .catch((err) =>
              setError(err instanceof Error ? err.message : 'Could not remove friend.')
            );
        },
      },
    ]);
  };

  const isFriend = (userId: string) => friends.some((row) => row.userId === userId);
  const isPending = (userId: string) =>
    outgoing.some((row) => row.userId === userId) ||
    incoming.some((row) => row.userId === userId);

  return (
    <Screen>
      <Pressable onPress={() => router.back()} hitSlop={12}>
        <ThemedText type="small" themeColor="textSecondary">
          ‹ Back
        </ThemedText>
      </Pressable>
      <ScreenHeader title="Friends" subtitle="Only accepted friends can split expenses with you." />

      <Card style={styles.card}>
        <ThemedText type="smallBold">Find by username</ThemedText>
        <View style={styles.searchRow}>
          <TextInput
            value={query}
            onChangeText={(value) => setQuery(value.toLowerCase())}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={20}
            placeholder="username"
            placeholderTextColor={theme.textSecondary}
            style={[
              styles.input,
              { color: theme.text, borderColor: theme.border, backgroundColor: theme.background },
            ]}
          />
          <Button title="Search" onPress={search} loading={searching} />
        </View>
        {result ? (
          <View style={[styles.result, { borderColor: theme.border }]}>
            <View style={styles.rowMain}>
              <ThemedText type="default">{result.display_name}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                @{result.username}
              </ThemedText>
            </View>
            {isFriend(result.id) ? (
              <ThemedText type="small" themeColor="textSecondary">
                Already friends
              </ThemedText>
            ) : isPending(result.id) ? (
              <ThemedText type="small" themeColor="textSecondary">
                Request pending
              </ThemedText>
            ) : (
              <Button title="Add friend" onPress={add} loading={busy} />
            )}
          </View>
        ) : null}
        {error ? (
          <ThemedText type="small" themeColor="danger">
            {error}
          </ThemedText>
        ) : null}
      </Card>

      {incoming.length > 0 ? (
        <>
          <ThemedText type="smallBold">Requests</ThemedText>
          <Card style={styles.listCard}>
            {incoming.map((row) => (
              <View key={row.userId} style={[styles.row, { borderColor: theme.border }]}>
                <View style={styles.rowMain}>
                  <ThemedText type="default">{row.displayName}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    @{row.username} wants to connect
                  </ThemedText>
                </View>
                <View style={styles.actions}>
                  <Button
                    title="Accept"
                    onPress={() => respond(row, true)}
                    disabled={busy}
                  />
                  <Button
                    title="Decline"
                    variant="ghost"
                    onPress={() => respond(row, false)}
                    disabled={busy}
                  />
                </View>
              </View>
            ))}
          </Card>
        </>
      ) : null}

      {outgoing.length > 0 ? (
        <>
          <ThemedText type="smallBold">Sent requests</ThemedText>
          <Card style={styles.listCard}>
            {outgoing.map((row) => (
              <View key={row.userId} style={[styles.row, { borderColor: theme.border }]}>
                <View style={styles.rowMain}>
                  <ThemedText type="default">{row.displayName}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    @{row.username} · awaiting response
                  </ThemedText>
                </View>
              </View>
            ))}
          </Card>
        </>
      ) : null}

      <ThemedText type="smallBold">Your friends</ThemedText>
      {friends.length === 0 ? (
        <EmptyState
          title="No friends yet"
          subtitle="Find someone by their username to start splitting shared expenses."
        />
      ) : (
        <Card style={styles.listCard}>
          {friends.map((row) => (
            <View key={row.userId} style={[styles.row, { borderColor: theme.border }]}>
              <View style={styles.rowMain}>
                <ThemedText type="default">{row.displayName}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  @{row.username}
                </ThemedText>
              </View>
              <Pressable onPress={() => remove(row)} hitSlop={8}>
                <ThemedText type="small" style={{ color: theme.danger }}>
                  Remove
                </ThemedText>
              </Pressable>
            </View>
          ))}
        </Card>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: Spacing.two,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  input: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: 16,
  },
  result: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
    paddingTop: Spacing.three,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  listCard: {
    paddingVertical: 0,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
    paddingVertical: Spacing.three,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowMain: {
    flexShrink: 1,
    gap: Spacing.half,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
});
