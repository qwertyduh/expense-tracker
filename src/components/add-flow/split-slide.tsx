import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Notice } from '@/components/ui/notice';
import { Fonts, Spacing } from '@/constants/theme';
import { listCachedAcceptedFriends, type CachedFriend } from '@/db/friends';
import { useAuth } from '@/hooks/use-auth';
import { useNotice } from '@/hooks/use-notice';
import { useTheme } from '@/hooks/use-theme';
import { loadFriends } from '@/lib/friends';
import { sanitizeDecimal } from '@/lib/matching';
import { reconcileSelfEdit, reconcileSplitEdit } from '@/lib/split-edit';

export type SplitParticipant = {
  name: string;
  shareAmount: number;
  username?: string;
  remoteUserId?: string;
};

/**
 * Reported upward so Preview and the DB write know how to record the expense.
 *
 * Semantics: totalAmount is the full bill; selfShare is YOUR portion of it
 * (what the expense row stores as `amount`). The remainder is split across the
 * other named participants, each of whom owes their share back. Hand-editing one
 * participant's share locks it and spreads what is left evenly across the rest,
 * so the shares always sum back to the bill.
 */
export type SplitSummary = {
  /** True when your share is less than the full bill (someone else covers the rest). */
  isSplit: boolean;
  totalAmount: number;
  /** Your portion of the bill — clamped to [0, totalAmount]. */
  selfShare: number;
  /** How many people the bill is shared across (1 = you alone). */
  participantCount: number;
  /** Named others and the amount each owes; empty when there is no split. */
  participants: SplitParticipant[];
};

export type SplitSlideProps = {
  totalAmount: number;
  onChange: (summary: SplitSummary) => void;
};

const QUICK_COUNTS = [1, 2, 3, 4, 5, 6, 7, 8];

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// One OTHER participant: their raw amount text (`share`) plus `locked`, which
// marks a share the user hand-typed so it survives the next rebalance. A linked
// account carries the remote user id + username; a bare name is local-only.
type OtherParticipant = {
  name: string;
  share: string;
  locked: boolean;
  username?: string;
  remoteUserId?: string;
};

// Keep an others array exactly `size` long, preserving what was already typed.
function resizeOthers(others: OtherParticipant[], size: number): OtherParticipant[] {
  if (size <= 0) return [];
  const next = others.slice(0, size);
  while (next.length < size) next.push({ name: '', share: '', locked: false });
  return next;
}

export function SplitSlide({ totalAmount, onChange }: SplitSlideProps) {
  const theme = useTheme();
  const router = useRouter();
  const { session, configured } = useAuth();
  const { notice, showNotice } = useNotice();
  const [count, setCount] = useState(1);
  // Raw "your share" text so "12." mid-edit stays representable. For count 1
  // it is always the full bill and the input is hidden.
  const [share, setShare] = useState('');
  // One entry per OTHER participant (length count - 1).
  const [others, setOthers] = useState<OtherParticipant[]>([]);
  const [friends, setFriends] = useState<CachedFriend[]>(() => listCachedAcceptedFriends());
  const [friendPicker, setFriendPicker] = useState<number | null>(null);

  // Refresh the cached friend list in the background; the cache makes the
  // picker usable offline too.
  useEffect(() => {
    if (!session) return;
    let active = true;
    loadFriends()
      .then(() => {
        if (active) setFriends(listCachedAcceptedFriends());
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [session]);

  const report = (nextCount: number, rawShare: string, nextOthers: OtherParticipant[]) => {
    const selfShare = round2(
      Math.max(0, Math.min(parseFloat(rawShare) || 0, totalAmount))
    );
    // Others carry whatever the live rebalance left them with; blank names
    // still produce a usable row for Preview + the DB write.
    const othersTotal = round2(totalAmount - selfShare);
    const participants: SplitParticipant[] =
      nextCount > 1 && othersTotal > 0
        ? nextOthers.map((other, i) => ({
            name: other.name.trim() || `Person ${i + 2}`,
            shareAmount: round2(Math.max(0, parseFloat(other.share) || 0)),
            username: other.username,
            remoteUserId: other.remoteUserId,
          }))
        : [];
    onChange({
      isSplit: nextCount > 1 && selfShare < round2(totalAmount),
      totalAmount,
      selfShare,
      participantCount: nextCount,
      participants,
    });
  };

  // Default to no-split (you alone, full bill) whenever the bill amount changes.
  useEffect(() => {
    setCount(1);
    setShare(String(round2(totalAmount)));
    setOthers([]);
    report(1, String(round2(totalAmount)), []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalAmount]);

  const evenShare = round2(totalAmount / count);
  const isSolo = count === 1;

  // Live self share used for the per-participant rebalance below.
  const selfShare = round2(Math.max(0, Math.min(parseFloat(share) || 0, totalAmount)));
  const othersPool = round2(totalAmount - selfShare);
  const showOthers = count > 1 && othersPool > 0;

  // Run a proposed edit through the shared reconciliation and surface its
  // result: reject with a notice, or apply the rebalanced shares (and any
  // fallback readjustment to your share, which is announced).
  const reconcile = (
    rows: OtherParticipant[],
    selfValue: number,
    typedValue: number | null
  ): { rows: OtherParticipant[]; self: number; selfChanged: boolean } | null => {
    const result = reconcileSplitEdit({
      total: totalAmount,
      self: selfValue,
      entries: rows.map((row) => ({ amount: parseFloat(row.share) || 0, locked: row.locked })),
      typedValue,
    });
    if (!result.ok) {
      showNotice(result.message);
      return null;
    }
    if (result.notice) showNotice(result.notice);
    return {
      rows: rows.map((row, i) =>
        row.locked ? row : { ...row, share: String(result.shares[i]) }
      ),
      self: result.self,
      selfChanged: result.selfChanged,
    };
  };

  const selectCount = (nextCount: number) => {
    const evenSelf = round2(totalAmount / nextCount);
    // Fresh split: clear every lock, so everyone else gets an even share.
    const resized = resizeOthers(others, nextCount - 1).map((other) => ({
      ...other,
      locked: false,
    }));
    const outcome = reconcile(resized, evenSelf, null);
    const applied = outcome ? outcome.rows : resized;
    setCount(nextCount);
    setShare(String(evenSelf));
    setOthers(applied);
    report(nextCount, String(evenSelf), applied);
  };

  const editShare = (raw: string) => {
    const cleaned = sanitizeDecimal(raw);
    // An empty field means 0, not "do nothing".
    const typed = parseFloat(cleaned) || 0;
    const result = reconcileSelfEdit({
      total: totalAmount,
      self: typed,
      entries: others.map((other) => ({
        amount: parseFloat(other.share) || 0,
        locked: other.locked,
      })),
    });
    if (!result.ok) {
      showNotice(result.message);
      return;
    }
    // Your field keeps its raw text (including empty); the FIRST participant
    // takes the whole difference and everyone else stays put.
    const nextOthers = others.map((other, i) =>
      i === 0 ? { ...other, share: String(result.shares[i]) } : other
    );
    setShare(cleaned);
    setOthers(nextOthers);
    report(count, cleaned, nextOthers);
  };

  const editOthersShare = (index: number, raw: string) => {
    const cleaned = sanitizeDecimal(raw);
    // Lock the row the user just typed in, then rebalance the rest around it.
    const next = others.map((other, i) =>
      i === index ? { ...other, share: cleaned, locked: true } : other
    );
    const outcome = reconcile(next, selfShare, parseFloat(cleaned) || 0);
    if (!outcome) return;
    const nextShare = outcome.selfChanged ? String(outcome.self) : share;
    setOthers(outcome.rows);
    if (outcome.selfChanged) setShare(nextShare);
    report(count, nextShare, outcome.rows);
  };

  const editName = (index: number, value: string) => {
    // Typing a different name detaches the account link: the user is now
    // describing a local-only participant.
    const next = others.map((other, i) =>
      i === index
        ? { ...other, name: value, username: undefined, remoteUserId: undefined }
        : other
    );
    setOthers(next);
    report(count, share, next);
  };

  const chooseFriend = (index: number, friend: CachedFriend) => {
    const next = others.map((other, i) =>
      i === index
        ? {
            ...other,
            name: friend.displayName,
            username: friend.username,
            remoteUserId: friend.userId,
          }
        : other
    );
    setOthers(next);
    report(count, share, next);
    setFriendPicker(null);
  };

  return (
    <View style={styles.body}>
      <Notice message={notice} />

      <ThemedText type="subtitle">Who&apos;s splitting this?</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        How many of you share this bill
      </ThemedText>

      <View style={styles.countChips}>
        {QUICK_COUNTS.map((c) => {
          const active = c === count;
          return (
            <Pressable
              key={c}
              onPress={() => selectCount(c)}
              style={[
                styles.countChip,
                {
                  backgroundColor: active ? theme.backgroundSelected : theme.backgroundElement,
                },
              ]}>
              <ThemedText type="smallBold">{c}</ThemedText>
            </Pressable>
          );
        })}
      </View>

      {isSolo ? (
        <ThemedText type="small" themeColor="textSecondary">
          No split — the full {`₹${round2(totalAmount).toFixed(2)}`} is yours
        </ThemedText>
      ) : (
        <>
          <View style={styles.splitArea}>
            <View style={styles.inputRow}>
              <ThemedText type="title">₹</ThemedText>
              <TextInput
                style={[styles.input, { color: theme.text }]}
                value={share}
                onChangeText={editShare}
                placeholder="0"
                placeholderTextColor={theme.textSecondary}
                selectionColor={theme.backgroundSelected}
                keyboardType="decimal-pad"
                inputAccessoryViewButtonLabel="Done"
                accessibilityLabel="Your share of the bill"
              />
            </View>
            <ThemedText type="small" themeColor="textSecondary">
              Your share · max {`₹${round2(totalAmount).toFixed(2)}`} · even share is{' '}
              {`₹${evenShare.toFixed(2)}`}
            </ThemedText>
          </View>

          {showOthers && (
            <View style={styles.participants}>
              <ThemedText type="small" themeColor="textSecondary">
                Who&apos;s covering the rest? Name each person and tweak their share
              </ThemedText>
              {others.map((other, index) => (
                <View key={index} style={styles.participantBlock}>
                  <View style={styles.participantRow}>
                    <TextInput
                      style={[
                        styles.nameInput,
                        {
                          color: theme.text,
                          borderColor: theme.border,
                          backgroundColor: theme.backgroundElement,
                        },
                      ]}
                      value={other.name}
                      onChangeText={(value) => editName(index, value)}
                      placeholder="Who are they? / name"
                      placeholderTextColor={theme.textSecondary}
                      selectionColor={theme.backgroundSelected}
                      inputAccessoryViewButtonLabel="Done"
                      accessibilityLabel={`Name of participant ${index + 2}`}
                    />
                    <TextInput
                      style={[
                        styles.shareInput,
                        {
                          color: theme.text,
                          borderColor: theme.border,
                          backgroundColor: theme.backgroundElement,
                        },
                      ]}
                      value={other.share}
                      onChangeText={(value) => editOthersShare(index, value)}
                      placeholder="0"
                      placeholderTextColor={theme.textSecondary}
                      selectionColor={theme.backgroundSelected}
                      keyboardType="decimal-pad"
                      inputAccessoryViewButtonLabel="Done"
                      accessibilityLabel={`Share for participant ${index + 2}`}
                    />
                  </View>
                  <Pressable onPress={() => setFriendPicker(index)} hitSlop={4}>
                    <ThemedText
                      type="small"
                      themeColor={other.username ? 'accent' : 'textSecondary'}>
                      {other.username
                        ? `@${other.username} · tap to change`
                        : 'Link a friend account (optional)'}
                    </ThemedText>
                  </Pressable>
                </View>
              ))}
              <ThemedText type="small" themeColor="textSecondary">
                Editing a share spreads the rest evenly across the others
              </ThemedText>
            </View>
          )}
        </>
      )}

      <Modal
        visible={friendPicker != null}
        transparent
        animationType="fade"
        onRequestClose={() => setFriendPicker(null)}>
        <Pressable style={styles.backdrop} onPress={() => setFriendPicker(null)}>
          <View
            style={[styles.pickerCard, { backgroundColor: theme.backgroundElement }]}
            onStartShouldSetResponder={() => true}>
            <ThemedText type="smallBold">Choose a friend</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Linked friends see this as a shared expense. Leave it unlinked to
              keep the participant local-only.
            </ThemedText>
            {!session ? (
              <>
                <ThemedText type="small" themeColor="textSecondary">
                  {configured
                    ? 'Sign in to add friends and share this expense. Without an account, keep the participant local-only.'
                    : 'Accounts are not configured in this build.'}
                </ThemedText>
                {configured ? (
                  <Pressable
                    onPress={() => {
                      setFriendPicker(null);
                      router.push('/sign-in');
                    }}>
                    <ThemedText type="smallBold">Sign in</ThemedText>
                  </Pressable>
                ) : null}
              </>
            ) : friends.length === 0 ? (
              <ThemedText type="small" themeColor="textSecondary">
                No friends yet. Add one from Settings → Friends.
              </ThemedText>
            ) : (
              <ScrollView style={styles.pickerList}>
                {friends.map((friend) => {
                  const usedByOther = others.some(
                    (other, i) => i !== friendPicker && other.remoteUserId === friend.userId
                  );
                  return (
                    <Pressable
                      key={friend.userId}
                      disabled={usedByOther}
                      onPress={() => {
                        if (friendPicker != null) chooseFriend(friendPicker, friend);
                      }}
                      style={[styles.pickerRow, { borderColor: theme.border }]}>
                      <View style={styles.rowMain}>
                        <ThemedText type="default">{friend.displayName}</ThemedText>
                        <ThemedText type="small" themeColor="textSecondary">
                          @{friend.username}
                        </ThemedText>
                      </View>
                      <ThemedText
                        type="small"
                        themeColor={usedByOther ? 'textSecondary' : 'accent'}>
                        {usedByOther ? 'Added' : 'Use'}
                      </ThemedText>
                    </Pressable>
                  );
                })}
              </ScrollView>
            )}
            <Pressable onPress={() => setFriendPicker(null)} hitSlop={8}>
              <ThemedText type="linkPrimary">Close</ThemedText>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    alignItems: 'center',
    gap: Spacing.three,
  },
  countChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: Spacing.two,
    maxWidth: 360,
  },
  countChip: {
    minWidth: 44,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
    alignItems: 'center',
  },
  splitArea: {
    alignItems: 'center',
    gap: Spacing.two,
  },
  participants: {
    alignSelf: 'stretch',
    maxWidth: 360,
    width: '100%',
    gap: Spacing.two,
  },
  participantBlock: {
    gap: Spacing.one,
  },
  participantRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  rowMain: {
    flexShrink: 1,
    gap: Spacing.half,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
  },
  pickerCard: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '70%',
    borderRadius: 16,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  pickerList: {
    flexGrow: 0,
  },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
    paddingVertical: Spacing.three,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  nameInput: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 16,
    fontFamily: Fonts.sans,
  },
  shareInput: {
    width: 96,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 16,
    fontFamily: Fonts.sans,
    textAlign: 'right',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: Spacing.two,
  },
  input: {
    fontSize: 48,
    lineHeight: 52,
    fontWeight: 600,
    fontFamily: Fonts.sans,
    minWidth: 120,
    textAlign: 'left',
  },
});
