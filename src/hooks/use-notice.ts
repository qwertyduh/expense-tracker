import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Holds a single ephemeral notice string and clears it after `durationMs`. Used
 * with <Notice /> for the non-blocking heads-ups on the split forms (e.g. "your
 * share was readjusted"), so they never block the user the way an Alert does.
 */
export function useNotice(durationMs = 4000) {
  const [notice, setNotice] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showNotice = useCallback(
    (message: string) => {
      setNotice(message);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setNotice(null), durationMs);
    },
    [durationMs]
  );

  const clearNotice = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setNotice(null);
  }, []);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  return { notice, showNotice, clearNotice };
}
