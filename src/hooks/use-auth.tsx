import type { Session } from '@supabase/supabase-js';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { clearFriendCache } from '@/db/friends';
import { linkSelfToProfile } from '@/db/people';
import { clearSharedDebtCache } from '@/db/shared-debts';
import { loadFriends } from '@/lib/friends';
import { registerForPushNotifications, unregisterPushToken } from '@/lib/push';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { clearActiveUserId, flushOutbox, setActiveUserId } from '@/lib/sync';

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

  // Monotonic token: an applyProfile for an older user/sign-out must never
  // write state after a newer one started.
  const applyGeneration = useRef(0);
  const appliedUserId = useRef<string | null>(null);

  const applyProfile = useCallback(async (userId: string | null, force = false) => {
    const generation = ++applyGeneration.current;
    const current = () => generation === applyGeneration.current;

    if (!userId) {
      appliedUserId.current = null;
      clearActiveUserId();
      setProfile(null);
      return;
    }

    // The session is known locally, so sync ownership must not depend on the
    // network: an offline cold start would otherwise leave no active user and
    // quarantine every shared expense queued that session.
    setActiveUserId(userId);

    const next = await fetchProfile(userId).catch(() => null);
    if (!current()) return;
    setProfile(next);
    if (!next) return;

    // Token refreshes re-emit the session; don't redo the whole bootstrap.
    if (appliedUserId.current === userId && !force) return;
    appliedUserId.current = userId;

    linkSelfToProfile({
      remoteUserId: next.id,
      username: next.username,
      displayName: next.display_name,
    });
    flushOutbox().catch(() => {});
    loadFriends().catch(() => {});
    registerForPushNotifications(next.id).catch(() => {});
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured) return;

    let active = true;

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!active) return;
        setSession(data.session);
        return applyProfile(data.session?.user.id ?? null);
      })
      .catch(() => {
        // Unreadable stored session: treat as signed out rather than hanging
        // on the blank gate forever.
        if (active) setSession(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      // supabase-js holds its auth lock while this callback runs; awaiting
      // another supabase call inside it can deadlock, so defer.
      setTimeout(() => {
        if (active) applyProfile(next?.user.id ?? null).catch(() => {});
      }, 0);
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
        emailRedirectTo: 'expensetracker://auth-callback',
      },
    });
    if (error) throw error;
    return { needsEmailConfirmation: !data.session };
  }, []);

  const signOut = useCallback(async () => {
    const userId = session?.user.id ?? null;

    // Best-effort: stop this device receiving the old account's notifications
    // (only this device; the account's other devices stay subscribed). A
    // network failure must not block signing out.
    await unregisterPushToken().catch(() => {});

    // Account-scoped caches and the outbox owner go first, so nothing from this
    // account can flush or render under the next one. Outbox rows themselves
    // are kept, scoped to userId, and resume if this account signs back in.
    clearFriendCache();
    clearSharedDebtCache();
    clearActiveUserId();

    const { error } = await supabase.auth.signOut();
    if (error) {
      // Still signed in: restore ownership so sync keeps working.
      if (userId) setActiveUserId(userId);
      throw error;
    }
    setProfile(null);
  }, [session?.user.id]);

  const refreshProfile = useCallback(async () => {
    const userId = session?.user.id;
    if (userId) await applyProfile(userId, true);
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
