import type { Session } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { linkSelfToProfile } from '@/db/people';
import { loadFriends } from '@/lib/friends';
import { registerForPushNotifications } from '@/lib/push';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { flushOutbox } from '@/lib/sync';

export type Profile = {
  id: string;
  username: string;
  display_name: string;
};

type SignUpInput = {
  email: string;
  password: string;
  username: string;
  displayName: string;
};

type AuthContextValue = {
  configured: boolean;
  loading: boolean;
  session: Session | null;
  profile: Profile | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (input: SignUpInput) => Promise<{ needsEmailConfirmation: boolean }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function isValidUsername(value: string): boolean {
  return /^[a-z0-9]{3,20}$/.test(value);
}

export async function isUsernameAvailable(username: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('is_username_available', {
    p_username: username,
  });
  if (error) throw error;
  return Boolean(data);
}

async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, username, display_name')
    .eq('id', userId)
    .maybeSingle();

  if (error) throw error;
  return (data as Profile | null) ?? null;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(isSupabaseConfigured);

  const applyProfile = useCallback(async (userId: string | null) => {
    if (!userId) {
      setProfile(null);
      return;
    }
    const next = await fetchProfile(userId).catch(() => null);
    setProfile(next);
    if (next) {
      linkSelfToProfile({
        remoteUserId: next.id,
        username: next.username,
        displayName: next.display_name,
      });
      flushOutbox().catch(() => {});
      loadFriends().catch(() => {});
      registerForPushNotifications(next.id).catch(() => {});
    }
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured) return;

    let active = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      applyProfile(data.session?.user.id ?? null).finally(() => {
        if (active) setLoading(false);
      });
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      applyProfile(next?.user.id ?? null);
    });

    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, [applyProfile]);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (error) throw error;
  }, []);

  const signUp = useCallback(async (input: SignUpInput) => {
    const username = input.username.trim().toLowerCase();
    if (!isValidUsername(username)) {
      throw new Error('Username must be 3-20 lowercase letters or numbers.');
    }
    const displayName = input.displayName.trim();
    if (!displayName) throw new Error('Display name is required.');

    const { data, error } = await supabase.auth.signUp({
      email: input.email.trim(),
      password: input.password,
      options: {
        data: { username, display_name: displayName },
      },
    });
    if (error) throw error;
    return { needsEmailConfirmation: !data.session };
  }, []);

  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    setProfile(null);
  }, []);

  const refreshProfile = useCallback(async () => {
    const userId = session?.user.id;
    if (userId) await applyProfile(userId);
  }, [applyProfile, session?.user.id]);

  const value = useMemo(
    () => ({
      configured: isSupabaseConfigured,
      loading,
      session,
      profile,
      signIn,
      signUp,
      signOut,
      refreshProfile,
    }),
    [loading, profile, refreshProfile, session, signIn, signOut, signUp]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
