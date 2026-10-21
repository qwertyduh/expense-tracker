import { Link, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { PasswordField } from '@/components/ui/password-field';
import { Screen, ScreenHeader } from '@/components/ui/screen';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { useKeyboardHeight } from '@/hooks/use-keyboard';
import { useTheme } from '@/hooks/use-theme';

export default function SignInScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { configured, signIn } = useAuth();
  const keyboardHeight = useKeyboardHeight();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setError(null);
    if (!email.trim() || !password) {
      setError('Enter your email and password.');
      return;
    }
    setLoading(true);
    try {
      await signIn(email, password);
      router.replace('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sign in.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={[styles.flex, { paddingBottom: keyboardHeight }]}>
      <Screen
        contentStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag">
        <ScreenHeader
          title="Expense Tracker"
          subtitle="Sign in to sync shared expenses with friends."
        />

        {!configured ? (
          <Card style={styles.card}>
            <ThemedText type="smallBold">Backend not configured</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Add EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY to
              .env.local, then restart Expo.
            </ThemedText>
          </Card>
        ) : (
          <Card style={styles.card}>
            <ThemedText type="smallBold">Email</ThemedText>
            <TextInput
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="emailAddress"
              placeholder="you@example.com"
              placeholderTextColor={theme.textSecondary}
              style={[
                styles.input,
                { color: theme.text, borderColor: theme.border, backgroundColor: theme.background },
              ]}
            />
            <ThemedText type="smallBold">Password</ThemedText>
            <PasswordField
              value={password}
              onChangeText={setPassword}
              textContentType="password"
              autoComplete="current-password"
              placeholder="Your password"
              placeholderTextColor={theme.textSecondary}
            />
            {error ? (
              <ThemedText type="small" themeColor="danger">
                {error}
              </ThemedText>
            ) : null}
            <Button title="Sign in" onPress={submit} loading={loading} />
          </Card>
        )}

        {configured ? (
          <View style={styles.linksColumn}>
            <View style={styles.links}>
              <ThemedText type="small" themeColor="textSecondary">
                New here?
              </ThemedText>
              <Link href="/sign-up">
                <ThemedText type="linkPrimary">Create an account</ThemedText>
              </Link>
            </View>
            <Link href="/forgot-password">
              <ThemedText type="linkPrimary">Forgot password?</ThemedText>
            </Link>
          </View>
        ) : (
          <ActivityIndicator color={theme.textSecondary} />
        )}
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
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: 16,
  },
  linksColumn: {
    alignItems: 'center',
    gap: Spacing.two,
  },
  links: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
  },
});
