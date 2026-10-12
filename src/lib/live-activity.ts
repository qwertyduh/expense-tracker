import { requireOptionalNativeModule } from 'expo-modules-core';

type LiveActivityNativeModule = {
  startTestActivity(amount: string, vendor: string, category: string): Promise<string>;
  endAllActivities(): Promise<number>;
  /** Persist the learned vendor → category map (JSON) for the intent to read. */
  setMerchantCategoryMap(json: string): Promise<void>;
  /** Raw SMS texts of capsules shown but not yet reviewed or saved. */
  getPendingCaptures(): Promise<string[]>;
  /** Drop one pending capture (e.g. the user tapped Edit or confirmed). */
  removePendingCapture(text: string): Promise<void>;
};

// Backed by `app-intents/LiveActivityModule.swift` (inline module, iOS app target only).
// Optional so the web/Android bundles and Expo Go do not crash on import.
const Native = requireOptionalNativeModule<LiveActivityNativeModule>('LiveActivity');

export const liveActivity = {
  /** True only in an iOS build that compiled the native Live Activity module. */
  available: Native != null,

  /** Start a throwaway expense-capture Live Activity. Returns its id. */
  async startTest(amount: string, vendor: string, category: string): Promise<string> {
    if (!Native) {
      throw new Error('Live Activity module is not available in this build.');
    }
    return Native.startTestActivity(amount, vendor, category);
  },

  /** End every expense-capture Live Activity. Returns how many ended. */
  async endAll(): Promise<number> {
    return Native ? Native.endAllActivities() : 0;
  },

  /** Push the learned vendor → category map so the intent can show a category. */
  async setMerchantCategoryMap(json: string): Promise<void> {
    if (!Native) return;
    await Native.setMerchantCategoryMap(json);
  },

  /** Capsule captures shown but not yet reviewed or saved. */
  async getPendingCaptures(): Promise<string[]> {
    return Native ? Native.getPendingCaptures() : [];
  },

  /** Drop one pending capture so it is not auto-logged. */
  async removePendingCapture(text: string): Promise<void> {
    if (!Native) return;
    await Native.removePendingCapture(text);
  },
};
