import {
  DarkTheme,
  DefaultTheme,
  Stack,
  ThemeProvider,
  useRouter,
  useRootNavigationState,
  useSegments,
} from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import { AppState, Linking, StyleSheet, useColorScheme, View } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { initDatabase } from '@/db/schema';
import { seedDatabase } from '@/db/seed';
import { AddExpenseIntentProvider } from '@/hooks/add-expense-intent-provider';
import { AuthProvider, useAuth } from '@/hooks/use-auth';
import { useAppIntentDispatcher } from '@/hooks/useAppIntentDispatcher';
import { loadFriends } from '@/lib/friends';
import { syncMerchantCategoryMap } from '@/lib/merchant-category-sync';
import { flushPendingCaptures } from '@/lib/pending-captures';
import { setPendingResetUrl } from '@/lib/reset-link';
import { flushOutbox } from '@/lib/sync';

SplashScreen.preventAutoHideAsync();

// Run before React renders so the first screen's data read already includes any
// capture auto-logged while the app was closed. `initDatabase` / `flushPendingCaptures`
// are synchronous, but a `_layout` effect runs *after* child screens mount, which is
// why this must not live in an effect.
initDatabase();
seedDatabase('Pranay'); // your name, used for the 'self' person row
syncMerchantCategoryMap();
flushPendingCaptures();

// Mounted inside AddExpenseIntentProvider: useAppIntentDispatcher reads
// AddExpenseIntentContext, which only exists under the provider.
function AppIntentListener() {
  useAppIntentDispatcher();
  return null;
}

// Mandatory account gate. Supabase restores a cached session from SecureStore,
// so signing in once is enough for normal offline use afterwards.
function AuthGate() {
  const { loading, session } = useAuth();
  const segments = useSegments();
  const rootNavigationState = useRootNavigationState();
  const router = useRouter();
  const [resetLink, setResetLink] = useState<string | null>(null);

  // Capture reset links before the auth redirect can swallow them. The reset
  // screen reads the stored URL so it still has the tokens after navigation.
  useEffect(() => {
    const handleUrl = (url: string | null) => {
      if (!url?.startsWith('expensetracker://reset-password')) return;
      setPendingResetUrl(url);
      setResetLink(url);
      if (rootNavigationState?.key) router.replace('/reset-password');
    };

    Linking.getInitialURL().then(handleUrl);
    const subscription = Linking.addEventListener('url', (event) => handleUrl(event.url));
    return () => subscription.remove();
  }, [rootNavigationState?.key, router]);

  // Once the reset screen has established a session (or the user backed out to
  // the auth group), resume normal gating.
  useEffect(() => {
    if (resetLink && (session || segments[0] === '(auth)')) {
      setResetLink(null);
    }
  }, [resetLink, segments, session]);

  useEffect(() => {
    if (loading || !rootNavigationState?.key || resetLink) return;
    const inAuthGroup = segments[0] === '(auth)';
    const inResetFlow = segments[0] === 'reset-password';
    if (!session && !inAuthGroup && !inResetFlow) {
      router.replace('/sign-in');
    } else if (session && inAuthGroup) {
      router.replace('/');
    }
  }, [loading, resetLink, rootNavigationState?.key, router, segments, session]);

  if (loading) {
    return <View style={styles.gate} />;
  }

  return (
    <Stack>
      <Stack.Screen name="(auth)" options={{ headerShown: false }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="add" options={{ presentation: 'modal' }} />
      <Stack.Screen name="reset-password" options={{ headerShown: false }} />
      <Stack.Screen name="receive" options={{ presentation: 'modal' }} />
      <Stack.Screen name="friends" options={{ headerShown: false }} />
      <Stack.Screen name="debts" options={{ headerShown: false }} />
      <Stack.Screen name="owed" options={{ headerShown: false }} />
      <Stack.Screen name="person/[id]" options={{ headerShown: false }} />
    </Stack>
  );
}

export default function RootLayout() {
  const colorScheme = useColorScheme();

  // Keep the Live Activity's vendor -> category map fresh, and log any capsule the
  // user ignored or dismissed, on every return to the foreground.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        syncMerchantCategoryMap();
        flushPendingCaptures();
        flushOutbox().catch(() => {});
        loadFriends().catch(() => {});
      }
    });
    return () => subscription.remove();
  }, []);

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AnimatedSplashOverlay />
      <AuthProvider>
        <AddExpenseIntentProvider>
          <AppIntentListener />
          <AuthGate />
        </AddExpenseIntentProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  gate: {
    flex: 1,
    backgroundColor: '#0B0B0C',
  },
});
