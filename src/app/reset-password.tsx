import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { PasswordField } from '@/components/ui/password-field';
import { Screen, ScreenHeader } from '@/components/ui/screen';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { takePendingResetUrl } from '@/lib/reset-link';
import { supabase } from '@/lib/supabase';

function authParams(url: string): URLSearchParams {
  const hash = url.indexOf('#');
  const query = url.indexOf('?');
  const start = hash >= 0 ? hash + 1 : query >= 0 ? query + 1 : -1;
  if (start < 0) return new URLSearchParams();
  return new URLSearchParams(url.slice(start));
}

export default function ResetPasswordScreen() {
  const theme = useTheme();
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [checking, setChecking] = useState(true);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;

    const apply = async (url: string | null) => {
      if (!url || !active) return;
      if (!url.startsWith('expensetracker://reset-password')) return;
      setChecking(true);
      setError(null);
      const params = authParams(url);
      const accessToken = params.get('access_token');
      const refreshToken = params.get('refresh_token');
      const code = params.get('code');
      const description = params.get('error_description');

      if (description) {
        setError(description.replace(/\+/g, ' '));
        setChecking(false);
        return;
      }

      try {
        if (accessToken && refreshToken) {
          const { error: sessionError } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (sessionError) throw sessionError;
          setReady(true);
        } else if (code) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
          if (exchangeError) throw exchangeError;
          setReady(true);
        } else {
          setError('This reset link is missing its login token. Request a new email.');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'This reset link is invalid or expired.');
      } finally {
        if (active) setChecking(false);
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

  const submit = async () => {
    setError(null);
    setMessage(null);
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (password !== confirm) {
      setError('The passwords do not match.');
      return;
    }
    setLoading(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      await supabase.auth.signOut();
      router.replace('/sign-in');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reset the password.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.flex}>
      <Screen contentStyle={styles.content} keyboardShouldPersistTaps="handled">
        <ScreenHeader
          title="Reset password"
          subtitle="Choose a new password for your account."
        />

        <Card style={styles.card}>
          {checking ? (
            <ThemedText type="small" themeColor="textSecondary">
              Opening your reset link…
            </ThemedText>
          ) : null}

          {!checking && !ready ? (
            <>
              <ThemedText type="small" themeColor="danger">
                {error ?? 'Open the reset link from your email on this phone.'}
              </ThemedText>
              <Button title="Back to sign in" variant="ghost" onPress={() => router.replace('/sign-in')} />
            </>
          ) : null}

          {ready ? (
            <>
              <ThemedText type="smallBold">New password</ThemedText>
              <PasswordField
                value={password}
                onChangeText={setPassword}
                textContentType="newPassword"
                autoComplete="new-password"
                placeholder="At least 6 characters"
                placeholderTextColor={theme.textSecondary}
              />
              <ThemedText type="smallBold">Confirm new password</ThemedText>
              <PasswordField
                value={confirm}
                onChangeText={setConfirm}
                textContentType="newPassword"
                autoComplete="new-password"
                placeholder="Re-enter the password"
                placeholderTextColor={theme.textSecondary}
              />
              {error ? (
                <ThemedText type="small" themeColor="danger">
                  {error}
                </ThemedText>
              ) : null}
              {message ? (
                <ThemedText type="small" themeColor="accent">
                  {message}
                </ThemedText>
              ) : null}
              <Button title="Set new password" onPress={submit} loading={loading} />
            </>
          ) : null}
        </Card>
      </Screen>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  content: {
    justifyContent: 'center',
    flexGrow: 1,
  },
  card: {
    gap: Spacing.two,
  },
});
