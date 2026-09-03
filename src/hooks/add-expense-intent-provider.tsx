import { useRouter } from 'expo-router';
import { ReactNode, createContext, useCallback, useContext, useEffect, useMemo } from 'react';

import { useAddExpenseIntent } from './useAddExpenseIntent';

// The low-level hook wires Linking listeners. It must stay mounted for the
// whole app lifetime so warm-start deep links are caught wherever the user is
// (not just while /add happens to be open), which is why it lives here at the
// root provider instead of inside add.tsx.
export type AddExpenseIntentApi = {
  intent: ReturnType<typeof useAddExpenseIntent>['intent'];
  clear: () => void;
  /** Manual open: set a manual intent and route to the add flow. */
  startManual: () => void;
};

const AddExpenseIntentContext = createContext<AddExpenseIntentApi | null>(null);

export function AddExpenseIntentProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { intent, openManual, clear } = useAddExpenseIntent();

  // A deep link can land while the app is anywhere (Home, History, ...). Hop
  // to /add the moment an sms intent exists. Cold-start links funnel here too.
  useEffect(() => {
    if (intent?.source === 'sms') {
      router.navigate('/add');
    }
  }, [intent, router]);

  const startManual = useCallback(() => {
    openManual();
    router.navigate('/add');
  }, [openManual, router]);

  const api = useMemo<AddExpenseIntentApi>(
    () => ({ intent, clear, startManual }),
    [intent, clear, startManual]
  );

  return <AddExpenseIntentContext.Provider value={api}>{children}</AddExpenseIntentContext.Provider>;
}

export function useAddExpenseIntentContext(): AddExpenseIntentApi {
  const ctx = useContext(AddExpenseIntentContext);
  if (!ctx) throw new Error('useAddExpenseIntentContext must be used inside AddExpenseIntentProvider');
  return ctx;
}
