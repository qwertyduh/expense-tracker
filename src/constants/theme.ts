/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import '@/global.css';

import { Platform } from 'react-native';

export const Colors = {
  light: {
    text: '#0B0B0C',
    background: '#F7F7F8',
    backgroundElement: '#FFFFFF',
    backgroundSelected: '#E7EEFB',
    textSecondary: '#60646C',
    accent: '#3C87F7',
    accentSoft: '#E7EEFB',
    border: '#E4E4E7',
    success: '#1F9D55',
    danger: '#E5484D',
    warning: '#B7791F',
  },
  dark: {
    text: '#F5F5F6',
    background: '#0B0B0C',
    backgroundElement: '#1A1B1E',
    backgroundSelected: '#22304A',
    textSecondary: '#9BA1A6',
    accent: '#5B9BFF',
    accentSoft: '#1B2A44',
    border: '#2A2B2F',
    success: '#3DD68C',
    danger: '#FF6369',
    warning: '#F5C062',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Radius = {
  sm: 8,
  md: 12,
  lg: 18,
  pill: 999,
} as const;


export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
