import { useEffect, useState } from "react";
import { Keyboard, KeyboardEvent, Platform } from "react-native";

/**
 * Current on-screen keyboard height in points, 0 while the keyboard is hidden.
 *
 * The add screen applies this as bottom padding while the keyboard is up, so
 * content shifts up via LAYOUT (padding), never via a transform — a transform on
 * a focused field's container makes iOS resign the keyboard. Layout padding is
 * exactly what KeyboardAvoidingView does internally, and it's safe.
 *
 * iOS fires keyboardWill* at the start of the animation; Android only emits
 * keyboardDid*, so fall back to those there.
 */
export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const show = Keyboard.addListener(showEvent, (e: KeyboardEvent) =>
      setHeight(e.endCoordinates.height),
    );
    const hide = Keyboard.addListener(hideEvent, () => setHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return height;
}
