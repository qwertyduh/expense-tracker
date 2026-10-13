import { requireOptionalNativeModule } from 'expo-modules-core';

type LiveActivityNativeModule = {
  endAllActivities(): Promise<number>;
  /** Persist the learned vendor → category map (JSON) for the intent to read. */
  setMerchantCategoryMap(json: string): Promise<void>;
  /** Raw SMS texts of capsules shown but not yet reviewed or saved. Synchronous. */
  getPendingCaptures(): string[];
  /** Drop one pending capture (e.g. the user tapped Edit or confirmed). Synchronous. */
  removePendingCapture(text: string): void;
};

// Backed by `app-intents/LiveActivityModule.swift` (inline module, iOS app target only).
// Optional so the web/Android bundles and Expo Go do not crash on import.
const Native = requireOptionalNativeModule<LiveActivityNativeModule>('LiveActivity');

export const liveActivity = {
  /** True only in an iOS build that compiled the native Live Activity module. */
  available: Native != null,

  /** End every expense-capture Live Activity. Returns how many ended. */
  async endAll(): Promise<number> {
    return Native ? Native.endAllActivities() : 0;
  },

  /** Push the learned vendor → category map so the intent can show a category. */
  async setMerchantCategoryMap(json: string): Promise<void> {
    if (!Native) return;
    await Native.setMerchantCategoryMap(json);
  },

  /** Capsule captures shown but not yet reviewed or saved. Synchronous. */
  getPendingCaptures(): string[] {
    return Native ? Native.getPendingCaptures() : [];
  },

  /** Drop one pending capture so it is not auto-logged. Synchronous. */
  removePendingCapture(text: string): void {
    Native?.removePendingCapture(text);
  },
};
