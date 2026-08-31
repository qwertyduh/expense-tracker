// Tabs

import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useColorScheme } from "react-native";

import { AnimatedSplashOverlay } from "@/components/animated-icon";

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();
  return (
    <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
      <AnimatedSplashOverlay />
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="add" options={{ presentation: "modal" }} />
      </Stack>
    </ThemeProvider>
  );
}

// DB

import { initDatabase } from "@/db/schema";
import { seedDatabase } from "@/db/seed";
import { useEffect } from "react";

// inside RootLayout, before the return:
useEffect(() => {
  initDatabase();
  seedDatabase("Pranay"); // your name, used for the 'self' person row
}, []);
