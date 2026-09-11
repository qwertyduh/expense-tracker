import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Modal, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Screen, ScreenHeader } from '@/components/ui/screen';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import {
  addCategory,
  countExpensesForCategory,
  deleteCategory,
  listAllCategories,
  renameCategory,
  reorderCategories,
  type CategoryRow,
} from '@/db/categories';
import { useTheme } from '@/hooks/use-theme';

export default function CategoriesScreen() {
  const theme = useTheme();
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<CategoryRow | null>(null);
  const [draft, setDraft] = useState('');

  const reload = useCallback(() => setCategories(listAllCategories()), []);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload])
  );

  const openAdd = () => {
    setEditing(null);
    setDraft('');
    setEditorOpen(true);
  };

  const openRename = (category: CategoryRow) => {
    setEditing(category);
    setDraft(category.name);
    setEditorOpen(true);
  };

  const save = () => {
    const name = draft.trim();
    if (!name) return;
    if (editing) {
      renameCategory(editing.id, name);
    } else {
      addCategory(name);
    }
    setEditorOpen(false);
    reload();
  };

  const remove = (category: CategoryRow) => {
    const used = countExpensesForCategory(category.id);
    Alert.alert(
      `Delete "${category.name}"?`,
      used > 0
        ? `${used} expense${used === 1 ? '' : 's'} use this category and will show as Uncategorized.`
        : 'This category is not used by any expense.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            deleteCategory(category.id);
            reload();
          },
        },
      ]
    );
  };

  const move = (index: number, direction: -1 | 1) => {
    const next = index + direction;
    if (next < 0 || next >= categories.length) return;
    const ids = categories.map((c) => c.id);
    [ids[index], ids[next]] = [ids[next], ids[index]];
    reorderCategories(ids);
    reload();
  };

  return (
    <Screen>
      <ScreenHeader
        title="Categories"
        subtitle="Order drives the quick-pick chips"
        right={<Button title="+ New" variant="secondary" onPress={openAdd} style={styles.newButton} />}
      />

      <Card style={styles.listCard}>
        {categories.map((category, index) => (
          <View key={category.id} style={[styles.row, { borderColor: theme.border }]}>
            <Pressable style={styles.rowMain} onPress={() => openRename(category)}>
              <ThemedText type="default">{category.name}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {category.last_used_at ? 'Used' : 'Never used'}
              </ThemedText>
            </Pressable>
            <View style={styles.rowActions}>
              <Pressable onPress={() => move(index, -1)} hitSlop={8}>
                <ThemedText type="subtitle" themeColor="textSecondary">
                  ↑
                </ThemedText>
              </Pressable>
              <Pressable onPress={() => move(index, 1)} hitSlop={8}>
                <ThemedText type="subtitle" themeColor="textSecondary">
                  ↓
                </ThemedText>
              </Pressable>
              <Pressable onPress={() => remove(category)} hitSlop={8}>
                <ThemedText type="small" style={{ color: theme.danger }}>
                  Delete
                </ThemedText>
              </Pressable>
            </View>
          </View>
        ))}
      </Card>

      <Modal visible={editorOpen} transparent animationType="fade" onRequestClose={() => setEditorOpen(false)}>
        <View style={styles.backdrop}>
          <Card style={styles.editor}>
            <ThemedText type="smallBold">{editing ? 'Rename category' : 'New category'}</ThemedText>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              autoFocus
              placeholder="Category name"
              placeholderTextColor={theme.textSecondary}
              style={[
                styles.input,
                { color: theme.text, backgroundColor: theme.background, borderColor: theme.border },
              ]}
            />
            <View style={styles.editorActions}>
              <Button title="Cancel" variant="ghost" onPress={() => setEditorOpen(false)} />
              <Button title="Save" onPress={save} />
            </View>
          </Card>
        </View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  newButton: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
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
  rowActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
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
