import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Fonts, Spacing } from '@/constants/theme';
import { getExpenseParticipants, setExpenseSplit } from '@/db/expenses';
import {
  getIncomingReceipt,
  listPendingIncomingReceipts,
  markIncomingReceipt,
} from '@/db/incoming-receipts';
import { insertSettlement, listOutstandingShares, OutstandingShare } from '@/db/settlements';
import { useKeyboardHeight } from '@/hooks/use-keyboard';
import { ReceiveIntent, useReceiveIntent } from '@/hooks/receive-intent';
import { useTheme } from '@/hooks/use-theme';
import { MatchCandidate, nameMatches, rankCandidates, resplitEvenly } from '@/lib/matching';
import { formatDate } from '@/lib/format';

const STEP_NAMES = ['Amount', 'Person', 'Expense', 'Confirm'] as const;
const LAST_STEP = STEP_NAMES.length - 1;
const SAVED_DELAY_MS = 900;
const MONEY_EPSILON = 0.005;

// Explicit choice on the Expense step: either link to a share, or record the
// money without linking anything. null means the user hasn't decided yet.
type ExpenseChoice = { kind: 'selected'; candidate: MatchCandidate } | { kind: 'none' };

function fmt(n: number): string {
  return `₹${(Math.round(n * 100) / 100).toFixed(2)}`;
}

// Keeps only digits and a single decimal point (mirrors amount-slide).
function sanitizeAmount(raw: string): string {
  let out = raw.replace(/[^0-9.]/g, '');
  const firstDot = out.indexOf('.');
  if (firstDot !== -1) {
    out = out.slice(0, firstDot + 1) + out.slice(firstDot + 1).replace(/\./g, '');
  }
  return out;
}

function toCandidate(share: OutstandingShare): MatchCandidate {
  return {
    expenseId: share.expenseId,
    personId: share.personId,
    personName: share.personName,
    remaining: share.remaining,
    selfShare: share.selfShare,
    totalAmount: share.totalAmount,
    label: share.label,
    merchant: share.merchant,
    occurredAt: share.occurredAt,
  };
}

function candidateForExpense(expenseId: string): MatchCandidate | null {
  const share = listOutstandingShares().find((s) => s.expenseId === expenseId);
  return share ? toCandidate(share) : null;
}

type InitialState = {
  amount: string;
  personName: string;
  choice: ExpenseChoice | null;
  receiptId: string | null;
  rawText: string | null;
  bankSource: string | null;
};

// Resolve what the screen opens with: a deep-linked expense, a queued/ pending
// SMS receipt, or a fresh manual receive. Synchronous DB reads, so it can run
// in a useState initializer with no first-render flash.
function buildInitial(intent: ReceiveIntent | null, paramExpenseId: string | null): InitialState {
  const base: InitialState = {
    amount: '',
    personName: '',
    choice: null,
    receiptId: null,
    rawText: null,
    bankSource: null,
  };

  if (intent?.source === 'expense') {
    const candidate = candidateForExpense(intent.expenseId);
    return {
      ...base,
      personName: candidate?.personName ?? '',
      choice: candidate ? { kind: 'selected', candidate } : null,
    };
  }

  if (intent?.source === 'sms') {
    const receipt = getIncomingReceipt(intent.receiptId);
    const amount = intent.prefill.amount ?? receipt?.parsed_amount ?? null;
    return {
      amount: amount != null ? String(amount) : '',
      personName: intent.prefill.senderName ?? receipt?.parsed_name ?? '',
      choice: null,
      receiptId: intent.receiptId,
      rawText: intent.rawText || receipt?.raw_sms_text || null,
      bankSource: intent.prefill.bankSource ?? receipt?.bank_source ?? null,
    };
  }

  // No intent: the /receive?expenseId=... fallback wins over pending receipts.
  if (paramExpenseId) {
    const candidate = candidateForExpense(paramExpenseId);
    if (candidate) {
      return {
        ...base,
        personName: candidate.personName,
        choice: { kind: 'selected', candidate },
      };
    }
  }

  // Home "review" banner / direct open: work the newest pending receipt.
  const receipt = listPendingIncomingReceipts()[0];
  if (receipt) {
    return {
      amount: receipt.parsed_amount != null ? String(receipt.parsed_amount) : '',
      personName: receipt.parsed_name ?? '',
      choice: null,
      receiptId: receipt.id,
      rawText: receipt.raw_sms_text || null,
      bankSource: receipt.bank_source ?? null,
    };
  }

  return base;
}

export default function ReceiveScreen() {
  const router = useRouter();
  const { intent, clear } = useReceiveIntent();
  const params = useLocalSearchParams<{ expenseId?: string }>();
  const keyboardHeight = useKeyboardHeight();

  const [initial] = useState(() => buildInitial(intent, params.expenseId ?? null));
  const [currentStep, setCurrentStep] = useState(0);
  const [amount, setAmount] = useState(initial.amount);
  const [personName, setPersonName] = useState(initial.personName);
  const [choice, setChoice] = useState<ExpenseChoice | null>(initial.choice);
  const [receiptId] = useState(initial.receiptId);
  const [rawText] = useState(initial.rawText);
  const [bankSource] = useState(initial.bankSource);
  const [saved, setSaved] = useState(false);
  const [mismatch, setMismatch] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  const amountNum = parseFloat(amount) || 0;
  const selected = choice?.kind === 'selected' ? choice.candidate : null;
  const effectivePerson = selected?.personName ?? personName.trim();
  const canConfirm = amountNum > 0 && effectivePerson.length > 0;

  const candidates = useMemo(
    () =>
      rankCandidates(
        listOutstandingShares().map(toCandidate),
        amountNum,
        personName.trim() || null
      ),
    [amountNum, personName]
  );

  const goHome = () => {
    clear();
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/');
    }
  };

  // ✕ discard: a reviewed receipt leaves the pending list as dismissed.
  const close = () => {
    if (receiptId && !saved) markIncomingReceipt(receiptId, 'dismissed');
    goHome();
  };

  const goNext = () => setCurrentStep((step) => Math.min(step + 1, LAST_STEP));
  const goBack = () => setCurrentStep((step) => Math.max(step - 1, 0));
  // Any edit invalidates a mismatch prompt from a previous Confirm.
  const editAmount = (next: string) => {
    setAmount(next);
    setMismatch(false);
  };
  const editPerson = (next: string) => {
    setPersonName(next);
    setMismatch(false);
  };
  const selectCandidate = (candidate: MatchCandidate) => {
    setChoice({ kind: 'selected', candidate });
    setMismatch(false);
  };
  const selectNone = () => {
    setChoice({ kind: 'none' });
    setMismatch(false);
  };

  // Write the settlement (+ optional allocation), mark the receipt linked, then
  // show "Received ✓" briefly before exiting home.
  const persist = (allocations: { expenseId: string; amount: number }[]) => {
    insertSettlement({
      personName: effectivePerson,
      amount: amountNum,
      source: receiptId ? 'sms' : 'manual',
      bankSource: receiptId ? bankSource : null,
      rawSmsText: receiptId ? rawText : null,
      occurredAt: new Date().toISOString(),
      allocations,
    });
    if (receiptId) markIncomingReceipt(receiptId, 'linked');
    setSaved(true);
    timer.current = setTimeout(goHome, SAVED_DELAY_MS);
  };

  const confirm = () => {
    if (!canConfirm) return;
    const allocations = selected
      ? [{ expenseId: selected.expenseId, amount: amountNum }]
      : [];
    // Partial/over-payment on a linked share needs a decision, not a silent write.
    if (selected && Math.abs(selected.remaining - amountNum) > MONEY_EPSILON) {
      setMismatch(true);
      return;
    }
    persist(allocations);
  };

  // Rebalance the expense across everyone who shared it, then record the payment.
  const resplitAndSave = () => {
    if (!selected) return;
    const participants = getExpenseParticipants(selected.expenseId);
    const partyCount = participants.length + 1; // + you
    const shares = resplitEvenly(selected.totalAmount, partyCount);
    setExpenseSplit(
      selected.expenseId,
      shares[0],
      participants.map((p, i) => ({ name: p.personName, shareAmount: shares[i + 1] }))
    );
    persist([{ expenseId: selected.expenseId, amount: amountNum }]);
  };

  // Keep the typed amount, record it as-is, and hand off to the expense editor
  // to fix the split manually.
  const confirmAndEditAmount = () => {
    if (!selected) return;
    insertSettlement({
      personName: effectivePerson,
      amount: amountNum,
      source: receiptId ? 'sms' : 'manual',
      bankSource: receiptId ? bankSource : null,
      rawSmsText: receiptId ? rawText : null,
      occurredAt: new Date().toISOString(),
      allocations: [{ expenseId: selected.expenseId, amount: amountNum }],
    });
    if (receiptId) markIncomingReceipt(receiptId, 'linked');
    clear();
    router.replace({
      pathname: '/expense/[id]',
      params: { id: selected.expenseId, edit: '1' },
    });
  };

  const canGoNext = currentStep < LAST_STEP && !(currentStep === 2 && choice == null);

  return (
    <ThemedView style={[styles.container, { paddingBottom: keyboardHeight }]}>
      <View style={styles.header}>
        <ThemedText type="smallBold">
          {currentStep + 1}/{STEP_NAMES.length} {STEP_NAMES[currentStep]}
        </ThemedText>
        {!saved && (
          <Pressable onPress={close} hitSlop={12} accessibilityLabel="Close receive money">
            <ThemedText type="subtitle">✕</ThemedText>
          </Pressable>
        )}
      </View>

      {saved ? (
        <View style={styles.saved}>
          <ThemedText type="title">Received ✓</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Money in recorded
          </ThemedText>
        </View>
      ) : currentStep === 0 ? (
        <AmountStep value={amount} onChange={editAmount} autoFocus={initial.amount === ''} />
      ) : currentStep === 1 ? (
        <PersonStep value={personName} onChange={editPerson} />
      ) : currentStep === 2 ? (
        <ExpenseStep
          candidates={candidates}
          choice={choice}
          amountNum={amountNum}
          personName={personName}
          onSelect={selectCandidate}
          onNone={selectNone}
        />
      ) : (
        <ConfirmStep
          amountNum={amountNum}
          personName={effectivePerson}
          selected={selected}
          rawText={rawText}
          canConfirm={canConfirm}
          mismatch={mismatch}
          onConfirm={confirm}
          onResplit={resplitAndSave}
          onEditAmount={confirmAndEditAmount}
        />
      )}

      {!saved && (
        <View style={styles.footer}>
          {currentStep > 0 && (
            <Pressable onPress={goBack}>
              <ThemedText type="link">Back</ThemedText>
            </Pressable>
          )}
          {canGoNext && (
            <Pressable onPress={goNext} style={styles.next}>
              <ThemedText type="linkPrimary">Next</ThemedText>
            </Pressable>
          )}
        </View>
      )}
    </ThemedView>
  );
}

function AmountStep({
  value,
  onChange,
  autoFocus,
}: {
  value: string;
  onChange: (next: string) => void;
  autoFocus: boolean;
}) {
  const theme = useTheme();

  return (
    <View style={styles.wrapper}>
      <View style={styles.bodyCenter}>
        <ThemedText type="subtitle">How much came in?</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          The amount you received
        </ThemedText>

        <View style={styles.inputRow}>
          <ThemedText type="title">₹</ThemedText>
          <TextInput
            style={[styles.amountInput, { color: theme.text }]}
            value={value}
            onChangeText={(raw) => onChange(sanitizeAmount(raw))}
            placeholder="0"
            placeholderTextColor={theme.textSecondary}
            selectionColor={theme.backgroundSelected}
            keyboardType="decimal-pad"
            inputAccessoryViewButtonLabel="Done"
            autoFocus={autoFocus}
            accessibilityLabel="Amount received"
          />
        </View>
      </View>
    </View>
  );
}

function PersonStep({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const theme = useTheme();

  return (
    <View style={styles.wrapper}>
      <View style={styles.bodyCenter}>
        <ThemedText type="subtitle">Who paid you back?</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          The sender&apos;s name
        </ThemedText>

        <TextInput
          style={[styles.personInput, { color: theme.text, backgroundColor: theme.backgroundElement }]}
          value={value}
          onChangeText={onChange}
          placeholder="Name"
          placeholderTextColor={theme.textSecondary}
          autoCapitalize="words"
          autoFocus
          accessibilityLabel="Person name"
        />
      </View>
    </View>
  );
}

function Badge({ label }: { label: string }) {
  const theme = useTheme();

  return (
    <View style={[styles.badge, { backgroundColor: theme.accentSoft }]}>
      <ThemedText type="small" themeColor="accent" style={styles.badgeText}>
        {label}
      </ThemedText>
    </View>
  );
}

function CandidateRow({
  candidate,
  selected,
  amountNum,
  personName,
  onPress,
}: {
  candidate: MatchCandidate;
  selected: boolean;
  amountNum: number;
  personName: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  const amountMatch =
    amountNum > 0 && Math.abs(candidate.remaining - amountNum) < MONEY_EPSILON;
  const nameMatch = nameMatches(personName.trim() || null, candidate.personName);
  const descriptor = candidate.label ?? candidate.merchant ?? 'Expense';

  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.candidate,
        { backgroundColor: selected ? theme.backgroundSelected : theme.backgroundElement },
      ]}>
      <View style={styles.candidateMain}>
        <ThemedText type="smallBold">{candidate.personName}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {descriptor} · {formatDate(candidate.occurredAt)}
        </ThemedText>
        {(nameMatch || amountMatch) && (
          <View style={styles.badges}>
            {nameMatch && <Badge label="Name match" />}
            {amountMatch && <Badge label="Amount match" />}
          </View>
        )}
      </View>
      <ThemedText type="default">{fmt(candidate.remaining)}</ThemedText>
    </Pressable>
  );
}

function ExpenseStep({
  candidates,
  choice,
  amountNum,
  personName,
  onSelect,
  onNone,
}: {
  candidates: MatchCandidate[];
  choice: ExpenseChoice | null;
  amountNum: number;
  personName: string;
  onSelect: (candidate: MatchCandidate) => void;
  onNone: () => void;
}) {
  const theme = useTheme();
  const selectedId = choice?.kind === 'selected' ? choice.candidate.expenseId : null;
  const selectedPersonId = choice?.kind === 'selected' ? choice.candidate.personId : null;
  const noneSelected = choice?.kind === 'none';

  return (
    <View style={styles.bodyFill}>
      <ThemedText type="subtitle">Which expense?</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Match this payment to what they owe you
      </ThemedText>

      <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
        {candidates.map((candidate) => (
          <CandidateRow
            key={`${candidate.expenseId}:${candidate.personId}`}
            candidate={candidate}
            selected={
              candidate.expenseId === selectedId && candidate.personId === selectedPersonId
            }
            amountNum={amountNum}
            personName={personName}
            onPress={() => onSelect(candidate)}
          />
        ))}

        <Pressable
          onPress={onNone}
          style={[
            styles.noneRow,
            { backgroundColor: noneSelected ? theme.backgroundSelected : theme.backgroundElement },
          ]}>
          <ThemedText type="smallBold">None of these</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Record without linking an expense
          </ThemedText>
        </Pressable>
      </ScrollView>
    </View>
  );
}

function Row({ k, v, emphasize }: { k: string; v: string; emphasize?: boolean }) {
  return (
    <View style={styles.row}>
      <ThemedText type="small" themeColor="textSecondary">
        {k}
      </ThemedText>
      <ThemedText type={emphasize ? 'smallBold' : 'default'} style={styles.rowValue}>
        {v}
      </ThemedText>
    </View>
  );
}

function ConfirmStep({
  amountNum,
  personName,
  selected,
  rawText,
  canConfirm,
  mismatch,
  onConfirm,
  onResplit,
  onEditAmount,
}: {
  amountNum: number;
  personName: string;
  selected: MatchCandidate | null;
  rawText: string | null;
  canConfirm: boolean;
  mismatch: boolean;
  onConfirm: () => void;
  onResplit: () => void;
  onEditAmount: () => void;
}) {
  const theme = useTheme();

  return (
    <View style={styles.bodyFill}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <ThemedText type="subtitle">Confirm</ThemedText>

        <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
          <Row k="Amount" v={fmt(amountNum)} emphasize />
          <Row k="From" v={personName || '—'} />
          <Row
            k="Expense"
            v={selected ? selected.label ?? selected.merchant ?? 'Expense' : 'Not linked'}
          />
          {selected && <Row k="Remaining" v={fmt(selected.remaining)} />}
        </View>

        {rawText != null && rawText !== '' && (
          <>
            <ThemedText type="smallBold" style={styles.sectionTitle}>
              From SMS
            </ThemedText>
            <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
              <ThemedText type="small">{rawText}</ThemedText>
            </View>
          </>
        )}

        {mismatch && (
          <>
            <ThemedText type="small" themeColor="warning" style={styles.warn}>
              {fmt(amountNum)} doesn&apos;t match the {fmt(selected?.remaining ?? 0)} remaining on this
              expense.
            </ThemedText>
            <Pressable
              onPress={onResplit}
              style={[styles.actionPrimary, { backgroundColor: theme.backgroundSelected }]}>
              <ThemedText type="smallBold">Resplit remaining evenly</ThemedText>
            </Pressable>
            <Pressable
              onPress={onEditAmount}
              style={[styles.actionSecondary, { borderColor: theme.border }]}>
              <ThemedText type="smallBold">Confirm & edit amount</ThemedText>
            </Pressable>
          </>
        )}
      </ScrollView>

      {!mismatch && (
        <Pressable
          onPress={onConfirm}
          disabled={!canConfirm}
          style={[
            styles.actionPrimary,
            { backgroundColor: canConfirm ? theme.backgroundSelected : theme.backgroundElement },
          ]}>
          <ThemedText type="smallBold" themeColor={canConfirm ? 'text' : 'textSecondary'}>
            Confirm & Save
          </ThemedText>
        </Pressable>
      )}
      {!mismatch && !canConfirm && (
        <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
          Enter an amount and who paid you
        </ThemedText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: Spacing.six,
    paddingHorizontal: Spacing.four,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Spacing.four,
  },
  next: {
    marginLeft: 'auto',
  },
  wrapper: {
    flex: 1,
    justifyContent: 'center',
  },
  bodyCenter: {
    alignItems: 'center',
    gap: Spacing.two,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: Spacing.two,
  },
  amountInput: {
    fontSize: 48,
    lineHeight: 52,
    fontWeight: 600,
    fontFamily: Fonts.sans,
    minWidth: 120,
    textAlign: 'left',
  },
  personInput: {
    alignSelf: 'stretch',
    fontSize: 18,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    borderRadius: Spacing.two,
    marginTop: Spacing.two,
  },
  bodyFill: {
    flex: 1,
    gap: Spacing.three,
  },
  scroll: {
    paddingBottom: Spacing.three,
  },
  list: {
    gap: Spacing.two,
    paddingBottom: Spacing.three,
  },
  candidate: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    borderRadius: Spacing.two,
  },
  candidateMain: {
    flex: 1,
    gap: Spacing.half,
  },
  badges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    marginTop: Spacing.half,
  },
  badge: {
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
    borderRadius: 999,
  },
  badgeText: {
    fontSize: 12,
    lineHeight: 16,
  },
  noneRow: {
    alignItems: 'flex-start',
    gap: Spacing.half,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    borderRadius: Spacing.two,
  },
  card: {
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Spacing.two,
    gap: Spacing.four,
  },
  rowValue: {
    flexShrink: 1,
  },
  sectionTitle: {
    marginTop: Spacing.two,
  },
  warn: {
    textAlign: 'center',
  },
  actionPrimary: {
    alignItems: 'center',
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
  },
  actionSecondary: {
    alignItems: 'center',
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
    borderWidth: 1,
  },
  hint: {
    textAlign: 'center',
  },
  saved: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
  },
});
