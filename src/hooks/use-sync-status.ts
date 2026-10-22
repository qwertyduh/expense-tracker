import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { AppState } from 'react-native';

import { flushOutbox, getSyncStatus, retryFailedSync, type SyncStatus } from '@/lib/sync';

export function useSyncStatus() {
  const [status, setStatus] = useState<SyncStatus>(() => getSyncStatus());

  const refresh = useCallback(() => {
    setStatus(getSyncStatus());
  }, []);

  useFocusEffect(
    useCallback(() => {
      refresh();
      const subscription = AppState.addEventListener('change', (state) => {
        if (state === 'active') refresh();
      });
      return () => subscription.remove();
    }, [refresh])
  );

  const retry = useCallback(async () => {
    retryFailedSync();
    refresh();
    await flushOutbox().catch(() => {});
    refresh();
  }, [refresh]);

  return { ...status, refresh, retry };
}
