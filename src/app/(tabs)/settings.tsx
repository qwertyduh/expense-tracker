import * as Linking from 'expo-linking';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Modal, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Screen, ScreenHeader } from '@/components/ui/screen';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { forgetMerchant, listMerchantMemory, type MerchantMemoryRow } from '@/db/merchant-memory';
import { getSelf, updateSelfName } from '@/db/people';
import { useTheme } from '@/hooks/use-theme';

export default function SettingsScreen() {
  const theme = useTheme();
  const [selfName, setSelfName] = useState('');
  const [memory, setMemory] = useState<MerchantMemoryRow[]>([]);
  const [editorOpen, setEditorOpen] = useState(false);
  const [draft, setDraft] = useState('');

  const reload = useCallback(() => {
    setSelfName(getSelf()?.display_name ?? '');
    setMemory(listMerchantMemory());
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

  const saveName = () => {
    const name = draft.trim();
    if (name) updateSelfName(name);
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
          reload();
        },
      },
    ]);
  };

  return (
    <Screen>
      <ScreenHeader title="Settings" />

      <Card>
        <ThemedText type="small" themeColor="textSecondary">
          Your name
        </ThemedText>
        <Pressable
          onPress={() => {
            setDraft(selfName);
            setEditorOpen(true);
          }}>
          <ThemedText type="subtitle">{selfName || 'Set your name'}</ThemedText>
        </Pressable>
      </Card>

      {Platform.OS === 'android' ? (
        <Card>
          <ThemedText type="smallBold">Payment detection</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Reads the GPay PIN screen on your device to auto-log payments. Nothing leaves your
            phone. Enable it in Accessibility settings.
          </ThemedText>
          <Button title="Open accessibility settings" variant="secondary" onPress={openSettings} />
        </Card>
      ) : null}

      <ThemedText type="smallBold" style={styles.sectionTitle}>
        Learned payees
      </ThemedText>
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

      <Card>
        <ThemedText type="small" themeColor="textSecondary">
          Expense Tracker · local-only, single user. All data stays on this device.
        </ThemedText>
      </Card>

      <Modal visible={editorOpen} transparent animationType="fade" onRequestClose={() => setEditorOpen(false)}>
        <View style={styles.backdrop}>
          <Card style={styles.editor}>
            <ThemedText type="smallBold">Your name</ThemedText>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              autoFocus
              placeholder="Name"
              placeholderTextColor={theme.textSecondary}
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
  sectionTitle: {
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
