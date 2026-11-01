import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { supabase } from '@/lib/supabase';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

// The token this install registered, so sign-out removes only this device and
// leaves the account's other devices subscribed.
let registeredToken: string | null = null;

export async function registerForPushNotifications(_userId: string): Promise<void> {
  if (!Device.isDevice) return;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('debts', {
      name: 'Shared debts',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  const current = await Notifications.getPermissionsAsync();
  let status = current.status;
  if (status !== 'granted') {
    const requested = await Notifications.requestPermissionsAsync();
    status = requested.status;
  }
  if (status !== 'granted') return;

  const projectId =
    Constants.easConfig?.projectId ??
    (Constants.expoConfig?.extra?.eas as { projectId?: string } | undefined)?.projectId;
  if (!projectId) return;

  const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;

  // A token belongs to one account at a time. A plain upsert is blocked by RLS
  // when another account on this device owned it, so reassignment goes through
  // a security-definer RPC. The error must surface: a silent failure here means
  // the previous account keeps receiving this device's notifications.
  const { error } = await supabase.rpc('register_device', {
    p_token: token,
    p_platform: Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'unknown',
  });
  if (error) throw error;
  registeredToken = token;
}

export async function unregisterPushToken(): Promise<void> {
  const token = registeredToken;
  if (!token) return;
  const { error } = await supabase.rpc('unregister_device', { p_token: token });
  if (error) throw error;
  registeredToken = null;
}
