import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';

import {
  listPairBalances,
  listSharedDebtRows,
  updateCachedShare,
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

  const refresh = useCallback(async () => {
    if (!configured || !session) {
      setBalances(listPairBalances());
      setRows(listSharedDebtRows());
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await pullSharedDebts();
      setBalances(listPairBalances());
      setRows(listSharedDebtRows());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sync shared debts.');
      setBalances(listPairBalances());
      setRows(listSharedDebtRows());
    } finally {
      setLoading(false);
    }
  }, [configured, session]);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  useEffect(() => {
    if (!configured || !session) return;
    const unsubscribe = subscribeToSharedDebts(() => {
      refresh();
    });
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    return () => {
      unsubscribe();
      appState.remove();
    };
  }, [configured, refresh, session]);

  const settle = useCallback(
    async (row: SharedDebtRow, amount: number, method: SettlementMethod = 'manual') => {
      if (method === 'manual') {
        updateCachedShare(row.participantId, 'paid', row.shareAmount);
        setBalances(listPairBalances());
      }
      try {
        await settleSharedDebt({
          participantId: row.participantId,
          expenseId: row.expenseId,
          amount,
          method,
        });
        await refresh();
      } catch (err) {
        await refresh();
        throw err;
      }
    },
    [refresh]
  );

  return { balances, rows, loading, error, refresh, settle };
}
