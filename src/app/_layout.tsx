import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { initDatabase } from '@/db/schema';
import { seedDatabase } from '@/db/seed';
import { AddExpenseIntentProvider } from '@/hooks/add-expense-intent-provider';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();

  // DB setup once at launch. Safe to re-run — init/seed check before writing.
  useEffect(() => {
    initDatabase();
    seedDatabase('Pranay'); // your name, used for the 'self' person row
  }, []);

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AnimatedSplashOverlay />
      <AddExpenseIntentProvider>
        <Stack>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="add" options={{ presentation: 'modal' }} />
        </Stack>
      </AddExpenseIntentProvider>
    </ThemeProvider>
  );
}
