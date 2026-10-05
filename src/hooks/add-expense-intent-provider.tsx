import { useRouter } from 'expo-router';
import { ReactNode, createContext, useCallback, useContext, useEffect, useMemo } from 'react';
import { AppState } from 'react-native';
import { ParsedTransaction, BankSource } from '@/parsers';

import { useAddExpenseIntent } from './useAddExpenseIntent';
import { useReceiveIntent, setReceiveIntent, ReceiveIntent } from './receive-intent';

// The low-level hook wires Linking listeners. It must stay mounted for the
// whole app lifetime so warm-start deep links are caught wherever the user is
// (not just while /add happens to be open), which is why it lives here at the
// root provider instead of inside add.tsx.
export type AddExpenseIntentApi = {
  intent: ReturnType<typeof useAddExpenseIntent>['intent'];
  clear: () => void;
  /** Manual open: set a manual intent and route to the add flow. */
  startManual: () => void;
  /** Internal: set an SMS intent from App Intent dispatcher and route to /add. */
  setSmsIntent: (prefill: ParsedTransaction, rawText: string, bankSource: BankSource) => void;
  receiveIntent: ReceiveIntent | null;
  /** Set a receive intent and route to /receive. */
  startReceive: (intent: ReceiveIntent) => void;
};

const AddExpenseIntentContext = createContext<AddExpenseIntentApi | null>(null);

export function AddExpenseIntentProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { intent, openManual, clear, setSmsIntent } = useAddExpenseIntent();
  const { intent: receiveIntent } = useReceiveIntent();

  // A deep link or App Intent can land while the app is anywhere (Home, History,
  // ...), and the App Intent path can have JS parse the message while the app is
  // still launching without a scene. Hop to /add the moment an sms intent exists,
  // and again whenever the app becomes active, so a cold foreground launch lands
  // on the pre-filled flow instead of Home. Cold-start links funnel here too.
  useEffect(() => {
    if (intent?.source !== 'sms') {
      return;
    }

    const goToAdd = () => {
      // Don't route without a scene; the active listener below covers launch.
      if (AppState.currentState === 'active') {
        router.navigate('/add');
      }
    };

    goToAdd();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        goToAdd();
      }
    });
    return () => subscription.remove();
  }, [intent, router]);

  // Mirror of the add-intent effect above for the incoming-money flow: a credit
  // SMS queued by the App Intent dispatcher sets a receive intent while the app
  // is launching. Route to /receive as soon as it exists, and again on the next
  // 'active' transition so a cold foreground launch lands on the review flow.
  useEffect(() => {
    if (receiveIntent === null) {
      return;
    }

    const goToReceive = () => {
      // Don't route without a scene; the active listener below covers launch.
      if (AppState.currentState === 'active') {
        router.navigate('/receive');
      }
    };

    goToReceive();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        goToReceive();
      }
    });
    return () => subscription.remove();
  }, [receiveIntent, router]);

  const startManual = useCallback(() => {
    openManual();
    router.navigate('/add');
  }, [openManual, router]);

  const startReceive = useCallback(
    (next: ReceiveIntent) => {
      setReceiveIntent(next);
      router.navigate('/receive');
    },
    [router]
  );

  const api = useMemo<AddExpenseIntentApi>(
    () => ({ intent, clear, startManual, setSmsIntent, receiveIntent, startReceive }),
    [intent, clear, startManual, setSmsIntent, receiveIntent, startReceive]
  );

  return <AddExpenseIntentContext.Provider value={api}>{children}</AddExpenseIntentContext.Provider>;
}

export function useAddExpenseIntentContext(): AddExpenseIntentApi {
  const ctx = useContext(AddExpenseIntentContext);
  if (!ctx) throw new Error('useAddExpenseIntentContext must be used inside AddExpenseIntentProvider');
  return ctx;
}
