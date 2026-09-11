import { NativeModules, Platform } from 'react-native';

export type DetectionMode = 'auto' | 'ask' | 'auto_all';

type PaymentDetectionNative = {
  isEnabled(): Promise<boolean>;
  setEnabled(enabled: boolean): Promise<boolean>;
  getMode(): Promise<DetectionMode>;
  setMode(mode: DetectionMode): Promise<boolean>;
  isAccessibilityServiceEnabled(): Promise<boolean>;
};

const native: PaymentDetectionNative | undefined =
  Platform.OS === 'android' ? NativeModules.PaymentDetection : undefined;

// Thin, safe wrapper: every call is a no-op (with sensible defaults) on iOS or
// if the native module isn't present, so the UI never crashes.
export const paymentDetection = {
  available: !!native,

  async isEnabled(): Promise<boolean> {
    if (!native) return true;
    return native.isEnabled();
  },

  async setEnabled(enabled: boolean): Promise<void> {
    if (!native) return;
    await native.setEnabled(enabled);
  },

  async getMode(): Promise<DetectionMode> {
    if (!native) return 'auto';
    return native.getMode();
  },

  async setMode(mode: DetectionMode): Promise<void> {
    if (!native) return;
    await native.setMode(mode);
  },

  async isAccessibilityServiceEnabled(): Promise<boolean> {
    if (!native) return false;
    return native.isAccessibilityServiceEnabled();
  },
};
