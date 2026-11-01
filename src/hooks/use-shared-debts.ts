import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import {
  listPairBalances,
  listSharedDebtRows,
  type PairBalance,
  type SharedDebtRow,
} from '@/db/shared-debts';
import { useAuth } from '@/hooks/use-auth';
import {
  pullSharedDebts,
  settleSharedDebt,
  subscribeToSharedDebts,
  type SettlementMethod,
} from '@/lib/shared-debts';

export function useSharedDebts() {
  const { session, configured } = useAuth();
  const [balances, setBalances] = useState<PairBalance[]>([]);
  const [rows, setRows] = useState<SharedDebtRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Overlapping pulls (focus + app-state + realtime) each rewrite the whole
  // cache; run them one at a time and coalesce requests made meanwhile into a
  // single follow-up, so an older response can never overwrite a newer one.
  const inFlight = useRef<Promise<void> | null>(null);
  const queued = useRef(false);

  const reload = useCallback(() => {
    setBalances(listPairBalances());
    setRows(listSharedDebtRows());
  }, []);

  const refresh = useCallback(async () => {
    if (!configured || !session) {
      reload();
      return;
    }
    if (inFlight.current) {
      queued.current = true;
      return inFlight.current;
    }
    const run = (async () => {
      setLoading(true);
      try {
        do {
          queued.current = false;
          setError(null);
          try {
            await pullSharedDebts();
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not sync shared debts.');
          }
          reload();
        } while (queued.current);
      } finally {
        setLoading(false);
        inFlight.current = null;
      }
    })();
    inFlight.current = run;
    return run;
  }, [configured, reload, session]);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  useEffect(() => {
    if (!configured || !session) return;
    // A burst of participant/expense changes arrives as many events; one pull
    // after the burst settles is enough.
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = subscribeToSharedDebts(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        refresh();
      }, 500);
    });
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    return () => {
      if (timer) clearTimeout(timer);
      unsubscribe();
      appState.remove();
    };
  }, [configured, refresh, session]);

  const settle = useCallback(
    async (row: SharedDebtRow, amount: number, method: SettlementMethod = 'manual') => {
      const outcome = await settleSharedDebt({
        participantId: row.participantId,
        expenseId: row.expenseId,
        amount,
        method,
      });
      // The server is the source of truth for settled_amount/status; never
      // optimistically mark the full share paid for a partial payment.
      await refresh();
      if (outcome.state === 'failed') {
        throw new Error(outcome.error ?? 'Could not settle this share.');
      }
      return outcome;
    },
    [refresh]
  );

  return { balances, rows, loading, error, refresh, settle };
}
