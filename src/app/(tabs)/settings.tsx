import * as Linking from 'expo-linking';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Modal, Platform, Pressable, StyleSheet, Switch, TextInput, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import { EmptyState } from '@/components/ui/empty-state';
import { Screen, ScreenHeader } from '@/components/ui/screen';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import {
  clearMerchantMemory,
  forgetMerchant,
  listMerchantMemory,
  type MerchantMemoryRow,
} from '@/db/merchant-memory';
import { getSelf, renamePerson, updateSelfName } from '@/db/people';
import {
  forgetHandle,
  listPeopleWithHandles,
  type PersonHandleRow,
  type PersonWithHandles,
} from '@/db/person-handles';
import { paymentDetection, type DetectionMode } from '@/lib/payment-detection';
import { syncMerchantCategoryMap } from '@/lib/merchant-category-sync';
import { useAuth } from '@/hooks/use-auth';
import { useSyncStatus } from '@/hooks/use-sync-status';
import { useTheme } from '@/hooks/use-theme';

const MODES: { value: DetectionMode; label: string; hint: string }[] = [
  { value: 'auto', label: 'Auto if known', hint: 'Known payees save silently; new ones ask.' },
  { value: 'ask', label: 'Always ask', hint: 'Show the category card for every payment.' },
  { value: 'auto_all', label: 'Fully automatic', hint: 'Never ask; unknown payees go to Unsorted.' },
];

export default function SettingsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { configured, session, profile, signOut } = useAuth();
  const {
    pending: pendingSync,
    failed: failedSync,
    lastError: syncError,
    retry: retrySync,
  } = useSyncStatus();
  const [selfName, setSelfName] = useState('');
  const [memory, setMemory] = useState<MerchantMemoryRow[]>([]);
  const [people, setPeople] = useState<PersonWithHandles[]>([]);
  const [editorOpen, setEditorOpen] = useState(false);
  // null = editing the self name; otherwise the non-self person being renamed.
  const [editorPersonId, setEditorPersonId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [detectionEnabled, setDetectionEnabled] = useState(true);
  const [mode, setMode] = useState<DetectionMode>('auto');
  const [serviceEnabled, setServiceEnabled] = useState(false);

  const reload = useCallback(() => {
    setSelfName(getSelf()?.display_name ?? '');
    setMemory(listMerchantMemory());
    setPeople(listPeopleWithHandles());
    if (paymentDetection.available) {
      paymentDetection.isEnabled().then(setDetectionEnabled).catch(() => {});
      paymentDetection.getMode().then(setMode).catch(() => {});
      paymentDetection.isAccessibilityServiceEnabled().then(setServiceEnabled).catch(() => {});
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload])
  );

  const openSettings = () => {
    if (Platform.OS === 'android') {
      Linking.sendIntent('android.settings.ACCESSIBILITY_SETTINGS');
    }
  };

  const toggleDetection = (next: boolean) => {
    setDetectionEnabled(next);
    paymentDetection.setEnabled(next).catch(() => {});
  };

  const chooseMode = (next: DetectionMode) => {
    setMode(next);
    paymentDetection.setMode(next).catch(() => {});
  };

  const openSelfEditor = () => {
    setDraft(selfName);
    setEditorPersonId(null);
    setEditorOpen(true);
  };

  const openPersonEditor = (person: PersonWithHandles['person']) => {
    setDraft(person.display_name);
    setEditorPersonId(person.id);
    setEditorOpen(true);
  };

  const saveName = () => {
    const name = draft.trim();
    if (name) {
      if (editorPersonId) renamePerson(editorPersonId, name);
      else updateSelfName(name);
    }
    setEditorOpen(false);
    reload();
  };

  const forget = (merchant: string) => {
    Alert.alert(`Forget "${merchant}"?`, 'It will ask for a category next time.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Forget',
        style: 'destructive',
        onPress: () => {
          forgetMerchant(merchant);
          syncMerchantCategoryMap();
          reload();
        },
      },
    ]);
  };

  const removeHandle = (handle: PersonHandleRow) => {
    const what = handle.kind === 'upi' ? `UPI id "${handle.label}"` : `name "${handle.label}"`;
    Alert.alert(`Remove ${what}?`, 'The next payment that matches it will ask again.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          forgetHandle(handle.handle_key);
          reload();
        },
      },
    ]);
  };

  const confirmSignOut = () => {
    const unsynced = pendingSync + failedSync;
    const message =
      unsynced > 0
        ? `${unsynced} change${unsynced === 1 ? '' : 's'} haven't synced yet. They will resume if you sign back in. Shared expenses will stop syncing until then.`
        : 'Shared expenses will stop syncing until you sign in again.';
    Alert.alert('Sign out?', message, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: () => {
          signOut().catch(() => {});
        },
      },
    ]);
  };

  const resetMemory = () => {
    Alert.alert('Reset learned payees?', 'All remembered payee → category mappings will be cleared.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reset',
        style: 'destructive',
        onPress: () => {
          clearMerchantMemory();
          syncMerchantCategoryMap();
          reload();
        },
      },
    ]);
  };

  const activeMode = MODES.find((m) => m.value === mode);

  return (
    <Screen>
      <ScreenHeader title="Settings" />

      <Card style={styles.detectionCard}>
        <ThemedText type="small" themeColor="textSecondary">
          Account
        </ThemedText>
        <ThemedText type="subtitle">{profile?.display_name ?? selfName}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {session
            ? `@${profile?.username ?? '…'}`
            : 'Local only. Sign in to add friends and split expenses.'}
        </ThemedText>
        {session ? (
          <>
            <Button
              title="Friends"
              variant="secondary"
              onPress={() => router.push('/friends')}
            />
            <Button title="Sign out" variant="ghost" onPress={confirmSignOut} />
          </>
        ) : configured ? (
          <>
            <Button title="Sign in" onPress={() => router.push('/sign-in')} />
            <Button
              title="Create account"
              variant="secondary"
              onPress={() => router.push('/sign-up')}
            />
          </>
        ) : null}
      </Card>

      <Card style={styles.detectionCard}>
        <ThemedText type="small" themeColor="textSecondary">
          Sync
        </ThemedText>
        <View style={styles.rowBetween}>
          <ThemedText type="default">
            {pendingSync} pending · {failedSync} failed
          </ThemedText>
          {failedSync > 0 ? (
            <Button title="Retry" variant="secondary" onPress={retrySync} />
          ) : null}
        </View>
        {syncError ? (
          <ThemedText type="small" themeColor="danger" numberOfLines={3}>
            {syncError}
          </ThemedText>
        ) : null}
      </Card>

      <Card>
        <ThemedText type="small" themeColor="textSecondary">
          Your name
        </ThemedText>
        <Pressable onPress={openSelfEditor}>
          <ThemedText type="subtitle">{selfName || 'Set your name'}</ThemedText>
        </Pressable>
      </Card>

      {Platform.OS === 'android' ? (
        <Card style={styles.detectionCard}>
          <View style={styles.rowBetween}>
            <ThemedText type="smallBold">Payment detection</ThemedText>
            <Switch value={detectionEnabled} onValueChange={toggleDetection} />
          </View>

          <View style={styles.rowBetween}>
            <ThemedText type="small" themeColor="textSecondary">
              Accessibility service
            </ThemedText>
            <ThemedText type="smallBold" style={{ color: serviceEnabled ? theme.success : theme.danger }}>
              {serviceEnabled ? 'Enabled' : 'Not enabled'}
            </ThemedText>
          </View>

          <ThemedText type="small" themeColor="textSecondary">
            Reads the GPay PIN screen on your device. Nothing leaves your phone.
          </ThemedText>

          <Button
            title={serviceEnabled ? 'Accessibility settings' : 'Enable in accessibility settings'}
            variant={serviceEnabled ? 'secondary' : 'primary'}
            onPress={openSettings}
          />

          <ThemedText type="smallBold" style={styles.modeTitle}>
            When a payment is detected
          </ThemedText>
          <View style={styles.modeChips}>
            {MODES.map((item) => (
              <Chip
                key={item.value}
                label={item.label}
                selected={item.value === mode}
                onPress={() => chooseMode(item.value)}
              />
            ))}
          </View>
          {activeMode ? (
            <ThemedText type="small" themeColor="textSecondary">
              {activeMode.hint}
            </ThemedText>
          ) : null}
        </Card>
      ) : null}

      <View style={styles.sectionHeader}>
        <ThemedText type="smallBold">Learned payees</ThemedText>
        {memory.length > 0 ? (
          <Pressable onPress={resetMemory} hitSlop={8}>
            <ThemedText type="small" style={{ color: theme.danger }}>
              Reset all
            </ThemedText>
          </Pressable>
        ) : null}
      </View>
      {memory.length === 0 ? (
        <EmptyState
          title="Nothing learned yet"
          subtitle="Once you categorize a payee, repeat payments are filed automatically."
        />
      ) : (
        <Card style={styles.listCard}>
          {memory.map((entry) => (
            <View key={entry.merchant} style={[styles.row, { borderColor: theme.border }]}>
              <View style={styles.rowMain}>
                <ThemedText type="default">{entry.merchant}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {entry.category_name ?? 'Unknown'}
                  {entry.split_count > 1 ? ` · split ${entry.split_count}` : ''}
                </ThemedText>
              </View>
              <Pressable onPress={() => forget(entry.merchant)} hitSlop={8}>
                <ThemedText type="small" style={{ color: theme.danger }}>
                  Forget
                </ThemedText>
              </Pressable>
            </View>
          ))}
        </Card>
      )}

      <View style={styles.sectionHeader}>
        <ThemedText type="smallBold">People</ThemedText>
      </View>
      {people.length === 0 ? (
        <EmptyState
          title="No people yet"
          subtitle="Name a sender once and their UPI id and name are remembered. Add more by naming them again."
        />
      ) : (
        <Card style={styles.listCard}>
          {people.map(({ person, handles }) => (
            <View key={person.id} style={[styles.personBlock, { borderColor: theme.border }]}>
              <Pressable onPress={() => openPersonEditor(person)} hitSlop={4}>
                <ThemedText type="default">{person.display_name}</ThemedText>
              </Pressable>
              {handles.length === 0 ? (
                <ThemedText type="small" themeColor="textSecondary">
                  No ids or names learned yet
                </ThemedText>
              ) : (
                handles.map((handle) => (
                  <View key={handle.handle_key} style={styles.handleRow}>
                    <ThemedText type="small" themeColor="textSecondary" style={styles.handleLabel}>
                      {handle.kind === 'upi' ? `UPI · ${handle.label}` : `Name · ${handle.label}`}
                    </ThemedText>
                    <Pressable onPress={() => removeHandle(handle)} hitSlop={8}>
                      <ThemedText type="small" style={{ color: theme.danger }}>
                        Remove
                      </ThemedText>
                    </Pressable>
                  </View>
                ))
              )}
            </View>
          ))}
        </Card>
      )}

      <Card>
        <ThemedText type="small" themeColor="textSecondary">
          Expense Tracker · local-only, single user. All data stays on this device.
        </ThemedText>
      </Card>

      <Modal visible={editorOpen} transparent animationType="fade" onRequestClose={() => setEditorOpen(false)}>
        <View style={styles.backdrop}>
          <Card style={styles.editor}>
            <ThemedText type="smallBold">{editorPersonId ? 'Rename person' : 'Your name'}</ThemedText>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              autoFocus
              placeholder="Name"
              placeholderTextColor={theme.textSecondary}
              inputAccessoryViewButtonLabel="Done"
              style={[
                styles.input,
                { color: theme.text, backgroundColor: theme.background, borderColor: theme.border },
              ]}
            />
            <View style={styles.editorActions}>
              <Button title="Cancel" variant="ghost" onPress={() => setEditorOpen(false)} />
              <Button title="Save" onPress={saveName} />
            </View>
          </Card>
        </View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  detectionCard: {
    gap: Spacing.three,
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
  },
  modeTitle: {
    marginTop: Spacing.one,
  },
  modeChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing.two,
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
  personBlock: {
    paddingVertical: Spacing.three,
    gap: Spacing.half,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  handleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
    paddingLeft: Spacing.two,
  },
  handleLabel: {
    flexShrink: 1,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
  },
  editor: {
    width: '100%',
    maxWidth: 420,
    gap: Spacing.three,
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: 16,
  },
  editorActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: Spacing.two,
  },
});
