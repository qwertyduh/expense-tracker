import { Link, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { PasswordField } from '@/components/ui/password-field';
import { Screen, ScreenHeader } from '@/components/ui/screen';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { supabase } from '@/lib/supabase';

export default function ForgotPasswordScreen() {
  const theme = useTheme();
  const router = useRouter();
  const [step, setStep] = useState<'email' | 'reset'>('email');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const sendOtp = async () => {
    setError(null);
    setMessage(null);
    if (!email.trim()) {
      setError('Enter the email on your account.');
      return;
    }
    setLoading(true);
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(
        email.trim(),
        { redirectTo: 'expensetracker://reset-password' }
      );
      if (resetError) throw resetError;
      setStep('reset');
      setMessage('If that email has an account, a reset link and 6-digit code are on their way.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the reset code.');
    } finally {
      setLoading(false);
    }
  };

  const resetPassword = async () => {
    setError(null);
    setMessage(null);
    if (!/^\d{6}$/.test(otp.trim())) {
      setError('Enter the 6-digit code from the email.');
      return;
    }
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
      const { error: verifyError } = await supabase.auth.verifyOtp({
        email: email.trim(),
        token: otp.trim(),
        type: 'recovery',
      });
      if (verifyError) throw verifyError;

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
          title={step === 'email' ? 'Forgot password' : 'Enter reset code'}
          subtitle={
            step === 'email'
              ? 'We will email a one-time code to your account address.'
              : `Sent to ${email.trim()} — open the email link, or enter the code below.`
          }
        />

        <Card style={styles.card}>
          {step === 'email' ? (
            <>
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
            </>
          ) : (
            <>
              <ThemedText type="smallBold">6-digit code</ThemedText>
              <TextInput
                value={otp}
                onChangeText={(value) => setOtp(value.replace(/\D/g, '').slice(0, 6))}
                keyboardType="number-pad"
                maxLength={6}
                placeholder="123456"
                placeholderTextColor={theme.textSecondary}
                style={[
                  styles.input,
                  { color: theme.text, borderColor: theme.border, backgroundColor: theme.background },
                ]}
              />
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
            </>
          )}

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
            title={step === 'email' ? 'Send reset code' : 'Reset password'}
            onPress={step === 'email' ? sendOtp : resetPassword}
            loading={loading}
          />
          {step === 'reset' ? (
            <Button title="Resend code" variant="ghost" onPress={sendOtp} disabled={loading} />
          ) : null}
        </Card>

        <View style={styles.links}>
          <ThemedText type="small" themeColor="textSecondary">
            Remembered it?
          </ThemedText>
          <Link href="/sign-in">
            <ThemedText type="linkPrimary">Back to sign in</ThemedText>
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
  links: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
  },
});
