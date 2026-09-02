import { useEffect, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import {
  CategoryRow,
  listAllCategories,
  listRecentCategories,
  touchCategory,
} from '@/db/categories';
import { useTheme } from '@/hooks/use-theme';

export type CategorySlideProps = {
  selectedId: string | null;
  onSelect: (category: CategoryRow) => void;
};

export function CategorySlide({ selectedId, onSelect }: CategorySlideProps) {
  const theme = useTheme();
  const [recent, setRecent] = useState<CategoryRow[]>([]);
  const [listOpen, setListOpen] = useState(false);

  useEffect(() => {
    setRecent(listRecentCategories());
  }, []);

  const reloadRecent = () => setRecent(listRecentCategories());

  const pick = (category: CategoryRow) => {
    // Touch immediately so quick-pick re-orders live, even if the flow is
    // later abandoned (blueprint §3). Not deferred to Preview's confirm.
    touchCategory(category.id);
    reloadRecent();
    onSelect(category);
  };

  return (
    <View style={styles.body}>
      <ThemedText type="subtitle">What's the category?</ThemedText>

      <View style={styles.chips}>
        {recent.map((category) => {
          const selected = category.id === selectedId;
          return (
            <Pressable
              key={category.id}
              onPress={() => pick(category)}
              style={[
                styles.chip,
                { backgroundColor: selected ? theme.backgroundSelected : theme.backgroundElement },
              ]}>
              <ThemedText type="smallBold">{category.name}</ThemedText>
            </Pressable>
          );
        })}

        <Pressable
          onPress={() => setListOpen(true)}
          style={[styles.chip, { backgroundColor: theme.backgroundElement }]}>
          <ThemedText type="small">More…</ThemedText>
        </Pressable>
      </View>

      <Modal visible={listOpen} animationType="slide" transparent onRequestClose={() => setListOpen(false)}>
        <ThemedView style={styles.modal}>
          <View style={styles.modalHeader}>
            <ThemedText type="smallBold">All categories</ThemedText>
            <Pressable onPress={() => setListOpen(false)} hitSlop={12} accessibilityLabel="Close list">
              <ThemedText type="subtitle">✕</ThemedText>
            </Pressable>
          </View>

          <FlatList
            data={listAllCategories()}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => {
              const selected = item.id === selectedId;
              return (
                <Pressable
                  onPress={() => {
                    pick(item);
                    setListOpen(false);
                  }}
                  style={[
                    styles.row,
                    { backgroundColor: selected ? theme.backgroundSelected : theme.background },
                  ]}>
                  <ThemedText type="default">{item.name}</ThemedText>
                  {selected && <ThemedText type="small">✓</ThemedText>}
                </Pressable>
              );
            }}
          />
        </ThemedView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    alignItems: 'center',
    gap: Spacing.four,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: Spacing.two,
    maxWidth: 360,
  },
  chip: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: 999,
  },
  modal: {
    flex: 1,
    paddingTop: Spacing.six,
    paddingHorizontal: Spacing.four,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.three,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.two,
  },
});
