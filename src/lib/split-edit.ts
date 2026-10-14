// Shared reconciliation for the editable split forms. Pure (no React, no DB), so
// it is unit-testable and both the expense-edit screen and the add-flow split
// slide apply the exact same rules and produce the exact same wording.

import { formatCurrency } from './format';
import {
  rebalanceFromSelf,
  rebalanceParticipants,
  type RedistributableAmount,
} from './matching';

export type SplitEditResult =
  | { ok: false; message: string }
  | {
      ok: true;
      /** Reconciled participant shares, aligned to the input order. */
      shares: number[];
      /** Your share after any fallback readjustment. */
      self: number;
      /** True when the fallback moved your share off the value you set. */
      selfChanged: boolean;
      /** A non-blocking heads-up to show, or null when nothing needs saying. */
      notice: string | null;
    };

/**
 * Reconcile a proposed split edit against the bill.
 *
 * `typedValue` is the number the user just typed (omit it for edits to the
 * total, where there is nothing to compare against). Returns a rejection with a
 * human-readable reason when the edit can't be reconciled, otherwise the locked/
 * rebalanced shares and your possibly-readjusted share.
 */
export function reconcileSplitEdit(params: {
  total: number;
  self: number;
  entries: RedistributableAmount[];
  typedValue?: number | null;
}): SplitEditResult {
  const { total, self, entries, typedValue = null } = params;

  if (typedValue != null && typedValue > total) {
    return {
      ok: false,
      message: `${formatCurrency(typedValue)} is more than the ${formatCurrency(
        total
      )} bill, so that amount was left unchanged.`,
    };
  }

  const result = rebalanceParticipants(total, self, entries);
  if (result.overflows) {
    return {
      ok: false,
      message: `Those shares would add up to more than the ${formatCurrency(
        total
      )} bill, so that change was not applied.`,
    };
  }

  const nextSelf = Math.round((self + result.selfDelta) * 100) / 100;
  return {
    ok: true,
    shares: result.shares,
    self: nextSelf,
    selfChanged: result.selfDelta !== 0,
    notice:
      result.selfDelta !== 0
        ? `The total wasn't matching, so your share was readjusted to ${formatCurrency(nextSelf)}.`
        : null,
  };
}

/**
 * Reconcile an edit to YOUR OWN share. Your share is taken as typed and the
 * first participant absorbs the difference, so nothing else about the split
 * moves. Rejects a share larger than the bill, or one that would drive that
 * first participant negative.
 */
export function reconcileSelfEdit(params: {
  total: number;
  self: number;
  entries: RedistributableAmount[];
}): SplitEditResult {
  const { total, self, entries } = params;

  if (self > total) {
    return {
      ok: false,
      message: `${formatCurrency(self)} is more than the ${formatCurrency(
        total
      )} bill, so that amount was left unchanged.`,
    };
  }

  const result = rebalanceFromSelf(total, self, entries);
  if (result.overflows) {
    return {
      ok: false,
      message: `The rest of the split only leaves room for ${formatCurrency(
        total - entries.slice(1).reduce((sum, entry) => sum + entry.amount, 0)
      )} as your share, so that change was not applied.`,
    };
  }

  return {
    ok: true,
    shares: result.shares,
    self,
    selfChanged: false,
    notice: null,
  };
}
