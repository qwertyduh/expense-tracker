import { useId } from 'react';
import {
  InputAccessoryView,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

// React Native only auto-builds a "Done" toolbar via `inputAccessoryViewButtonLabel`
// for numeric keyboards (number/phone/decimal pad) because those have no Return
// key. Text keyboards already have a Return key, so the prop renders nothing
// there — a TextInput needs an explicit `InputAccessoryView` + `inputAccessoryViewID`
// instead. This is that toolbar, shared by the text fields.
//
// iOS attaches an `InputAccessoryView` to the *first* TextInput holding its
// nativeID, and only once — in `didMoveToWindow`. A screen-level accessory that
// mounts before the field (or a shared id reused by several fields) therefore
// silently never appears. `KeyboardDoneInput` below pairs one accessory with one
// field so every text input gets a working toolbar.
export function KeyboardDoneAccessory({ id }: { id: string }) {
  const theme = useTheme();

  // Android text keyboards already provide a confirm/return key, and
  // InputAccessoryView is iOS-only.
  if (Platform.OS !== 'ios') return null;

  return (
    <InputAccessoryView nativeID={id}>
      <View
        style={[
          styles.bar,
          { backgroundColor: theme.backgroundElement, borderTopColor: theme.border },
        ]}>
        <Pressable onPress={Keyboard.dismiss} hitSlop={8} accessibilityLabel="Dismiss keyboard">
          <ThemedText type="smallBold" themeColor="accent">
            Done
          </ThemedText>
        </Pressable>
      </View>
    </InputAccessoryView>
  );
}

/**
 * A `TextInput` that carries its own iOS "Done" keyboard toolbar.
 *
 * The field and its accessory render as adjacent siblings so the native
 * accessory attaches to this exact field during the same mount pass, and each
 * instance gets a unique nativeID from `useId` — so multiple text fields on one
 * screen (e.g. the split participant names) each dock their own toolbar.
 */
export function KeyboardDoneInput(props: TextInputProps) {
  const id = useId();

  return (
    <>
      <TextInput {...props} inputAccessoryViewID={id} />
      <KeyboardDoneAccessory id={id} />
    </>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
