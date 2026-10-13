import { useEffect } from 'react';

type Listener = () => void;

const listeners = new Set<Listener>();

/**
 * Signal that the expenses table changed outside the normal navigation flow — an
 * SMS capture auto-logged on foreground, or written by the capsule's Save button.
 * Screens that read expenses subscribe with `useExpensesChanged` so the new row
 * appears without a second app launch.
 */
export function notifyExpensesChanged(): void {
  listeners.forEach((listener) => listener());
}

/** Run `onChange` whenever expenses change out-of-band (e.g. an auto-logged capture). */
export function useExpensesChanged(onChange: () => void): void {
  useEffect(() => {
    listeners.add(onChange);
    return () => {
      listeners.delete(onChange);
    };
  }, [onChange]);
}
