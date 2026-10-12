import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { AppState, useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { initDatabase } from '@/db/schema';
import { seedDatabase } from '@/db/seed';
import { AddExpenseIntentProvider } from '@/hooks/add-expense-intent-provider';
import { useAppIntentDispatcher } from '@/hooks/useAppIntentDispatcher';
import { syncMerchantCategoryMap } from '@/lib/merchant-category-sync';
import { flushPendingCaptures } from '@/lib/pending-captures';

SplashScreen.preventAutoHideAsync();

// Mounted inside AddExpenseIntentProvider: useAppIntentDispatcher reads
// AddExpenseIntentContext, which only exists under the provider.
function AppIntentListener() {
  useAppIntentDispatcher();
  return null;
}

export default function RootLayout() {
  const colorScheme = useColorScheme();

  // DB setup once at launch. Safe to re-run — init/seed check before writing.
  useEffect(() => {
    initDatabase();
    seedDatabase('Pranay'); // your name, used for the 'self' person row
    syncMerchantCategoryMap();
    flushPendingCaptures();

    // Keep the Live Activity's vendor -> category map fresh, and log any capsule the
    // user ignored or dismissed: re-run on every return to the foreground.
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        syncMerchantCategoryMap();
        flushPendingCaptures();
      }
    });
    return () => subscription.remove();
  }, []);

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AnimatedSplashOverlay />
      <AddExpenseIntentProvider>
        <AppIntentListener />
        <Stack>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="add" options={{ presentation: 'modal' }} />
          <Stack.Screen name="receive" options={{ presentation: 'modal' }} />
          <Stack.Screen name="owed" options={{ headerShown: false }} />
          <Stack.Screen name="person/[id]" options={{ headerShown: false }} />
        </Stack>
      </AddExpenseIntentProvider>
    </ThemeProvider>
  );
}
