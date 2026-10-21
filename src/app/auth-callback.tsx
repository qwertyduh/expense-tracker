import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Screen, ScreenHeader } from '@/components/ui/screen';
import { Spacing } from '@/constants/theme';
import { takePendingResetUrl } from '@/lib/reset-link';
import { supabase } from '@/lib/supabase';

function authParams(url: string): URLSearchParams {
  const hash = url.indexOf('#');
  const query = url.indexOf('?');
  const start = hash >= 0 ? hash + 1 : query >= 0 ? query + 1 : -1;
  if (start < 0) return new URLSearchParams();
  return new URLSearchParams(url.slice(start));
}

export default function AuthCallbackScreen() {
  const router = useRouter();
  const [status, setStatus] = useState<'checking' | 'ready' | 'error'>('checking');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const apply = async (url: string | null) => {
      if (!url || !active) return;
      if (!url.startsWith('expensetracker://auth-callback')) return;
      setStatus('checking');
      const params = authParams(url);
      const accessToken = params.get('access_token');
      const refreshToken = params.get('refresh_token');
      const code = params.get('code');
      const description = params.get('error_description');

      if (description) {
        setError(description.replace(/\+/g, ' '));
        setStatus('error');
        return;
      }

      try {
        if (accessToken && refreshToken) {
          const { error: sessionError } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (sessionError) throw sessionError;
        } else if (code) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
          if (exchangeError) throw exchangeError;
        } else {
          throw new Error('This confirmation link is missing its login token.');
        }
        setStatus('ready');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'This confirmation link is invalid or expired.');
        setStatus('error');
      }
    };

    const pending = takePendingResetUrl();
    if (pending) {
      apply(pending);
    } else {
      Linking.getInitialURL().then(apply);
    }
    const subscription = Linking.addEventListener('url', (event) => apply(event.url));
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  return (
    <View style={styles.flex}>
      <Screen contentStyle={styles.content}>
        <ScreenHeader
          title="Email confirmed"
          subtitle="Your account is ready to use."
        />
        <Card style={styles.card}>
          {status === 'checking' ? (
            <ThemedText type="small" themeColor="textSecondary">
              Confirming your email…
            </ThemedText>
          ) : null}
          {status === 'error' ? (
            <ThemedText type="small" themeColor="danger">
              {error}
            </ThemedText>
          ) : null}
          {status === 'ready' ? (
            <ThemedText type="small" themeColor="textSecondary">
              You are signed in. Continue to start tracking expenses.
            </ThemedText>
          ) : null}
          <Button
            title={status === 'ready' ? 'Continue' : 'Go to sign in'}
            onPress={() => router.replace(status === 'ready' ? '/' : '/sign-in')}
          />
        </Card>
      </Screen>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { justifyContent: 'center', flexGrow: 1 },
  card: { gap: Spacing.two },
});
