import { describe, expect, it } from 'vitest';

import { reconcileSelfEdit, reconcileSplitEdit } from './split-edit';

describe('reconcileSplitEdit', () => {
  it('rebalances unlocked participants and leaves your share alone', () => {
    const result = reconcileSplitEdit({
      total: 100,
      self: 0,
      typedValue: 50,
      entries: [
        { amount: 50, locked: true },
        { amount: 33.33, locked: false },
        { amount: 33.33, locked: false },
      ],
    });

    expect(result).toMatchObject({
      ok: true,
      shares: [50, 25, 25],
      self: 0,
      selfChanged: false,
      notice: null,
    });
  });

  it('rejects an amount larger than the bill and says so', () => {
    const result = reconcileSplitEdit({
      total: 100,
      self: 0,
      typedValue: 150,
      entries: [{ amount: 150, locked: true }],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('more than the ₹100 bill');
    }
  });

  it('rejects a sum that would overshoot the bill', () => {
    const result = reconcileSplitEdit({
      total: 100,
      self: 0,
      typedValue: 30,
      entries: [
        { amount: 60, locked: true },
        { amount: 20, locked: true },
        { amount: 30, locked: true },
      ],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('more than the ₹100 bill');
    }
  });

  it('reads back your share once every participant is locked, with a notice', () => {
    const result = reconcileSplitEdit({
      total: 100,
      self: 0,
      typedValue: 40,
      entries: [
        { amount: 50, locked: true },
        { amount: 40, locked: true },
      ],
    });

    expect(result).toMatchObject({
      ok: true,
      shares: [50, 40],
      self: 10,
      selfChanged: true,
    });
    if (result.ok) {
      expect(result.notice).toContain('readjusted to ₹10');
    }
  });
});

describe('reconcileSelfEdit', () => {
  it('pushes the difference onto the first participant', () => {
    const result = reconcileSelfEdit({
      total: 100,
      self: 10,
      entries: [
        { amount: 50, locked: true },
        { amount: 25, locked: false },
        { amount: 25, locked: false },
      ],
    });

    expect(result).toMatchObject({
      ok: true,
      shares: [40, 25, 25],
      self: 10,
      selfChanged: false,
      notice: null,
    });
  });

  it('treats an empty/zero share as 0 and still reconciles', () => {
    const result = reconcileSelfEdit({
      total: 100,
      self: 0,
      entries: [
        { amount: 50, locked: false },
        { amount: 25, locked: false },
      ],
    });

    expect(result).toMatchObject({ ok: true, shares: [75, 25] });
  });

  it('rejects a share larger than the bill', () => {
    const result = reconcileSelfEdit({
      total: 100,
      self: 150,
      entries: [{ amount: 0, locked: false }],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('more than the ₹100 bill');
  });

  it('rejects when the first participant would go negative', () => {
    const result = reconcileSelfEdit({
      total: 100,
      self: 80,
      entries: [
        { amount: 50, locked: true },
        { amount: 30, locked: true },
      ],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('leaves room for ₹70');
  });
});
