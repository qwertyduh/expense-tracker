import { Link, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { PasswordField } from '@/components/ui/password-field';
import { Screen, ScreenHeader } from '@/components/ui/screen';
import { Spacing } from '@/constants/theme';
import { isUsernameAvailable, isValidUsername, useAuth } from '@/hooks/use-auth';
import { useKeyboardHeight } from '@/hooks/use-keyboard';
import { useTheme } from '@/hooks/use-theme';

export default function SignUpScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { configured, signUp } = useAuth();
  const keyboardHeight = useKeyboardHeight();
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [usernameStatus, setUsernameStatus] = useState<
    'idle' | 'checking' | 'available' | 'taken' | 'invalid'
  >('idle');

  useEffect(() => {
    const normalized = username.trim().toLowerCase();
    if (!normalized) {
      setUsernameStatus('idle');
      return;
    }
    if (!isValidUsername(normalized)) {
      setUsernameStatus('invalid');
      return;
    }
    setUsernameStatus('checking');
    let active = true;
    const timer = setTimeout(() => {
      isUsernameAvailable(normalized)
        .then((available) => {
          if (active) setUsernameStatus(available ? 'available' : 'taken');
        })
        .catch(() => {
          if (active) setUsernameStatus('idle');
        });
    }, 300);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [username]);

  const submit = async () => {
    setError(null);
    setMessage(null);

    const normalized = username.trim().toLowerCase();
    if (!displayName.trim()) {
      setError('Add a display name.');
      return;
    }
    if (!isValidUsername(normalized)) {
      setError('Username must be 3-20 lowercase letters or numbers.');
      return;
    }
    if (usernameStatus === 'taken') {
      setError('That username is already taken. Usernames are first come, first served.');
      return;
    }
    if (usernameStatus === 'checking') {
      setError('Still checking that username. Try again in a moment.');
      return;
    }
    if (!email.trim() || !password) {
      setError('Enter an email and password.');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }

    setLoading(true);
    try {
      const result = await signUp({
        email,
        password,
        username: normalized,
        displayName,
      });
      if (result.needsEmailConfirmation) {
        setMessage('Check your email to confirm your account, then sign in.');
      } else {
        router.replace('/');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      setError(
        /already registered|already exists|email.*exists/i.test(message)
          ? 'An account already exists for this email. Sign in or use Forgot password.'
          : /database error saving new user|duplicate|unique/i.test(message)
            ? 'That username or email is already in use. Usernames are first come, first served.'
            : message || 'Could not create the account.'
      );
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
          title="Create account"
          subtitle="Usernames are lowercase letters and numbers only."
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
            <ThemedText type="smallBold">Display name</ThemedText>
            <TextInput
              value={displayName}
              onChangeText={setDisplayName}
              placeholder="Anushka Gupta"
              placeholderTextColor={theme.textSecondary}
              style={[
                styles.input,
                { color: theme.text, borderColor: theme.border, backgroundColor: theme.background },
              ]}
            />

            <ThemedText type="smallBold">Username</ThemedText>
            <View style={styles.usernameRow}>
              <ThemedText type="default" themeColor="textSecondary">
                @
              </ThemedText>
              <TextInput
                value={username}
                onChangeText={(value) => setUsername(value.toLowerCase())}
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={20}
                placeholder="anushka123"
                placeholderTextColor={theme.textSecondary}
                style={[
                  styles.input,
                  styles.usernameInput,
                  { color: theme.text, borderColor: theme.border, backgroundColor: theme.background },
                ]}
              />
            </View>
            <ThemedText
              type="small"
              themeColor={
                usernameStatus === 'available'
                  ? 'success'
                  : usernameStatus === 'taken' || usernameStatus === 'invalid'
                    ? 'danger'
                    : 'textSecondary'
              }>
              {usernameStatus === 'checking'
                ? 'Checking availability…'
                : usernameStatus === 'available'
                  ? 'Available'
                  : usernameStatus === 'taken'
                    ? 'Already taken — usernames are first come, first served.'
                    : '3-20 characters, lowercase letters and numbers only.'}
            </ThemedText>

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
              textContentType="newPassword"
              autoComplete="new-password"
              placeholder="At least 6 characters"
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

            <Button
              title="Create account"
              onPress={submit}
              loading={loading}
              disabled={
                usernameStatus === 'checking' ||
                usernameStatus === 'taken' ||
                usernameStatus === 'invalid'
              }
            />
          </Card>
        )}

        <View style={styles.links}>
          <ThemedText type="small" themeColor="textSecondary">
            Already have an account?
          </ThemedText>
          <Link href="/sign-in">
            <ThemedText type="linkPrimary">Sign in</ThemedText>
          </Link>
        </View>
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
  usernameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  usernameInput: {
    flex: 1,
  },
  links: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
  },
});
