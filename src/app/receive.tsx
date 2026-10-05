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
import { getUpiAlias, rememberUpiAlias } from '@/db/upi-aliases';
import { useKeyboardHeight } from '@/hooks/use-keyboard';
import { ReceiveIntent, useReceiveIntent } from '@/hooks/receive-intent';
import { useTheme } from '@/hooks/use-theme';
import {
  allocateGreedy,
  Allocation,
  MatchCandidate,
  nameMatches,
  rankCandidates,
  resplitEvenly,
} from '@/lib/matching';
import { parseIncomingSms } from '@/parsers';
import { formatDate } from '@/lib/format';

const STEP_NAMES = ['Amount', 'Person', 'Expense', 'Confirm'] as const;
const LAST_STEP = STEP_NAMES.length - 1;
const SAVED_DELAY_MS = 900;
const MONEY_EPSILON = 0.005;

// Explicit choice on the Expense step: one or more shares from the SAME person,
// or "none" to record the money without linking anything. null = not decided.
type ExpenseChoice =
  | { kind: 'selected'; candidates: MatchCandidate[] }
  | { kind: 'none' };

function fmt(n: number): string {
  return `₹${(Math.round(n * 100) / 100).toFixed(2)}`;
}

function candidateKey(candidate: MatchCandidate): string {
  return `${candidate.expenseId}:${candidate.personId}`;
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

// Resolves a person name for an incoming SMS: a remembered UPI alias wins, then
// the parsed sender name, then anything stored on the receipt.
function resolvePersonName(upiId: string | null, fallback: string | null): string {
  if (upiId) {
    const alias = getUpiAlias(upiId);
    if (alias?.person_name) return alias.person_name;
  }
  return fallback ?? '';
}

type InitialState = {
  amount: string;
  personName: string;
  choice: ExpenseChoice | null;
  receiptId: string | null;
  rawText: string | null;
  bankSource: string | null;
  upiId: string | null;
};

// Resolve what the screen opens with: a deep-linked expense, a queued/pending
// SMS receipt, or a fresh manual receive. Synchronous DB reads, so it can run in
// a useState initializer with no first-render flash.
function buildInitial(intent: ReceiveIntent | null, paramExpenseId: string | null): InitialState {
  const base: InitialState = {
    amount: '',
    personName: '',
    choice: null,
    receiptId: null,
    rawText: null,
    bankSource: null,
    upiId: null,
  };

  if (intent?.source === 'expense') {
    const candidate = candidateForExpense(intent.expenseId);
    return {
      ...base,
      personName: candidate?.personName ?? '',
      choice: candidate ? { kind: 'selected', candidates: [candidate] } : null,
    };
  }

  if (intent?.source === 'sms') {
    const receipt = getIncomingReceipt(intent.receiptId);
    const amount = intent.prefill.amount ?? receipt?.parsed_amount ?? null;
    const rawText = intent.rawText || receipt?.raw_sms_text || '';
    const upiId = intent.prefill.upiId ?? (rawText ? parseIncomingSms(rawText).upiId : null);
    return {
      amount: amount != null ? String(amount) : '',
      personName: resolvePersonName(upiId, intent.prefill.senderName ?? receipt?.parsed_name ?? null),
      choice: null,
      receiptId: intent.receiptId,
      rawText: rawText || null,
      bankSource: intent.prefill.bankSource ?? receipt?.bank_source ?? null,
      upiId,
    };
  }

  // No intent: the /receive?expenseId=... fallback wins over pending receipts.
  if (paramExpenseId) {
    const candidate = candidateForExpense(paramExpenseId);
    if (candidate) {
      return { ...base, personName: candidate.personName, choice: { kind: 'selected', candidates: [candidate] } };
    }
  }

  // Home "review" banner / direct open: work the newest pending receipt.
  const receipt = listPendingIncomingReceipts()[0];
  if (receipt) {
    const parsed = parseIncomingSms(receipt.raw_sms_text);
    return {
      amount: receipt.parsed_amount != null ? String(receipt.parsed_amount) : '',
      personName: resolvePersonName(parsed.upiId, receipt.parsed_name),
      choice: null,
      receiptId: receipt.id,
      rawText: receipt.raw_sms_text || null,
      bankSource: receipt.bank_source ?? null,
      upiId: parsed.upiId,
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
  const [upiId] = useState(initial.upiId);
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
  const selectedCandidates = choice?.kind === 'selected' ? choice.candidates : [];
  const single = selectedCandidates.length === 1 ? selectedCandidates[0] : null;
  const effectivePerson = selectedCandidates[0]?.personName ?? personName.trim();
  const canConfirm = amountNum > 0 && effectivePerson.length > 0 && choice != null;
  const { allocations, unallocated } = allocateGreedy(selectedCandidates, amountNum);

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

  // Toggle a share in/out of the settlement. Only shares belonging to the same
  // person can be combined, so a receipt stays attributable to one sender.
  const toggleCandidate = (candidate: MatchCandidate) => {
    setMismatch(false);
    setChoice((prev) => {
      const current = prev?.kind === 'selected' ? prev.candidates : [];
      const key = candidateKey(candidate);
      const without = current.filter((c) => candidateKey(c) !== key);
      if (without.length !== current.length) {
        return without.length ? { kind: 'selected', candidates: without } : null;
      }
      if (current.length > 0 && current[0].personId !== candidate.personId) {
        return prev; // same person only
      }
      return { kind: 'selected', candidates: [...current, candidate] };
    });
  };

  const selectNone = () => {
    setChoice({ kind: 'none' });
    setMismatch(false);
  };

  // Write the settlement (+ allocations), remember the UPI alias, mark the
  // receipt linked, then show "Received ✓" briefly before exiting home.
  const persist = (allocs: Allocation[]) => {
    const { personId } = insertSettlement({
      personName: effectivePerson,
      amount: amountNum,
      source: receiptId ? 'sms' : 'manual',
      bankSource: receiptId ? bankSource : null,
      rawSmsText: receiptId ? rawText : null,
      occurredAt: new Date().toISOString(),
      allocations: allocs.map((allocation) => ({
        expenseId: allocation.expenseId,
        amount: allocation.amount,
      })),
    });
    // Learn "anushka@okhdfc -> Anushka" so the next receipt pre-fills.
    if (upiId) rememberUpiAlias(upiId, personId);
    if (receiptId) markIncomingReceipt(receiptId, 'linked');
    setSaved(true);
    timer.current = setTimeout(goHome, SAVED_DELAY_MS);
  };

  const confirm = () => {
    if (!canConfirm) return;
    // A single share that isn't exactly covered needs a decision, not a silent
    // write. Multiple shares just allocate oldest-first (leftover is surfaced).
    if (single && Math.abs(single.remaining - amountNum) > MONEY_EPSILON) {
      setMismatch(true);
      return;
    }
    persist(allocations);
  };

  // Rebalance the expense across everyone who shared it, then record the
  // payment. Only offered for a single share and only while the amount fits
  // inside the whole bill (a bigger amount can't be an even re-split).
  const resplitAndSave = () => {
    if (!single) return;
    const participants = getExpenseParticipants(single.expenseId);
    const partyCount = participants.length + 1; // + you
    const shares = resplitEvenly(single.totalAmount, partyCount);
    setExpenseSplit(
      single.expenseId,
      shares[0],
      participants.map((p, i) => ({ name: p.personName, shareAmount: shares[i + 1] }))
    );
    const index = participants.findIndex((p) => p.personId === single.personId);
    const newShare = index >= 0 ? shares[index + 1] : single.remaining;
    persist([{ expenseId: single.expenseId, amount: Math.min(amountNum, newShare) }]);
  };

  // Record what we can, then hand off to the expense editor to fix the split.
  const confirmAndEditAmount = () => {
    const target = selectedCandidates[0];
    if (!target) return;
    const { personId } = insertSettlement({
      personName: effectivePerson,
      amount: amountNum,
      source: receiptId ? 'sms' : 'manual',
      bankSource: receiptId ? bankSource : null,
      rawSmsText: receiptId ? rawText : null,
      occurredAt: new Date().toISOString(),
      allocations: allocations.map((allocation) => ({
        expenseId: allocation.expenseId,
        amount: allocation.amount,
      })),
    });
    if (upiId) rememberUpiAlias(upiId, personId);
    if (receiptId) markIncomingReceipt(receiptId, 'linked');
    clear();
    router.replace({
      pathname: '/expense/[id]',
      params: { id: target.expenseId, edit: '1' },
    });
  };

  const canResplit = single != null && amountNum <= single.totalAmount + MONEY_EPSILON;
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
        <PersonStep value={personName} onChange={editPerson} upiId={upiId} />
      ) : currentStep === 2 ? (
        <ExpenseStep
          candidates={candidates}
          choice={choice}
          amountNum={amountNum}
          personName={personName}
          onToggle={toggleCandidate}
          onNone={selectNone}
        />
      ) : (
        <ConfirmStep
          amountNum={amountNum}
          personName={effectivePerson}
          selectedCandidates={selectedCandidates}
          allocations={allocations}
          unallocated={unallocated}
          rawText={rawText}
          canConfirm={canConfirm}
          mismatch={mismatch}
          canResplit={canResplit}
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

function PersonStep({
  value,
  onChange,
  upiId,
}: {
  value: string;
  onChange: (next: string) => void;
  upiId: string | null;
}) {
  const theme = useTheme();

  return (
    <View style={styles.wrapper}>
      <View style={styles.bodyCenter}>
        <ThemedText type="subtitle">Who paid you back?</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {upiId ? `Sender UPI: ${upiId}` : 'The sender\u2019s name'}
        </ThemedText>

        <TextInput
          style={[styles.personInput, { color: theme.text, backgroundColor: theme.backgroundElement }]}
          value={value}
          onChangeText={onChange}
          placeholder="Name"
          placeholderTextColor={theme.textSecondary}
          autoCapitalize="words"
          autoFocus
          inputAccessoryViewButtonLabel="Done"
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
  disabled,
  amountNum,
  personName,
  onPress,
}: {
  candidate: MatchCandidate;
  selected: boolean;
  disabled: boolean;
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
      disabled={disabled}
      style={[
        styles.candidate,
        {
          backgroundColor: selected ? theme.backgroundSelected : theme.backgroundElement,
          opacity: disabled ? 0.4 : 1,
          borderColor: selected ? theme.accent : 'transparent',
        },
      ]}>
      <View style={styles.checkbox}>
        <ThemedText type="smallBold" themeColor={selected ? 'accent' : 'textSecondary'}>
          {selected ? '☑' : '☐'}
        </ThemedText>
      </View>
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
  onToggle,
  onNone,
}: {
  candidates: MatchCandidate[];
  choice: ExpenseChoice | null;
  amountNum: number;
  personName: string;
  onToggle: (candidate: MatchCandidate) => void;
  onNone: () => void;
}) {
  const theme = useTheme();
  const selectedKeys =
    choice?.kind === 'selected' ? new Set(choice.candidates.map(candidateKey)) : new Set<string>();
  const lockedPersonId = choice?.kind === 'selected' ? choice.candidates[0]?.personId ?? null : null;
  const noneSelected = choice?.kind === 'none';

  return (
    <View style={styles.bodyFill}>
      <ThemedText type="subtitle">Which expense?</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {lockedPersonId
          ? 'Add as many of their expenses as this payment covers'
          : 'Match this payment to what they owe you. Pick more than one if needed.'}
      </ThemedText>

      <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
        {candidates.map((candidate) => {
          const disabled = lockedPersonId != null && candidate.personId !== lockedPersonId;
          return (
            <CandidateRow
              key={candidateKey(candidate)}
              candidate={candidate}
              selected={selectedKeys.has(candidateKey(candidate))}
              disabled={disabled}
              amountNum={amountNum}
              personName={personName}
              onPress={() => onToggle(candidate)}
            />
          );
        })}

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
  selectedCandidates,
  allocations,
  unallocated,
  rawText,
  canConfirm,
  mismatch,
  canResplit,
  onConfirm,
  onResplit,
  onEditAmount,
}: {
  amountNum: number;
  personName: string;
  selectedCandidates: MatchCandidate[];
  allocations: Allocation[];
  unallocated: number;
  rawText: string | null;
  canConfirm: boolean;
  mismatch: boolean;
  canResplit: boolean;
  onConfirm: () => void;
  onResplit: () => void;
  onEditAmount: () => void;
}) {
  const theme = useTheme();
  const allocationFor = (expenseId: string) =>
    allocations.find((allocation) => allocation.expenseId === expenseId)?.amount ?? 0;

  return (
    <View style={styles.bodyFill}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <ThemedText type="subtitle">Confirm</ThemedText>

        <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
          <Row k="Amount" v={fmt(amountNum)} emphasize />
          <Row k="From" v={personName || '—'} />
          {selectedCandidates.length === 0 && <Row k="Expense" v="Not linked" />}
        </View>

        {selectedCandidates.length > 0 && (
          <>
            <ThemedText type="smallBold" style={styles.sectionTitle}>
              Paying back {selectedCandidates.length} expense
              {selectedCandidates.length === 1 ? '' : 's'}
            </ThemedText>
            <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
              {selectedCandidates.map((candidate) => (
                <Row
                  key={candidateKey(candidate)}
                  k={`${candidate.label ?? candidate.merchant ?? 'Expense'} · owed ${fmt(
                    candidate.remaining
                  )}`}
                  v={fmt(allocationFor(candidate.expenseId))}
                />
              ))}
            </View>
          </>
        )}

        {unallocated > 0 && (
          <ThemedText type="small" themeColor="warning" style={styles.warn}>
            {fmt(unallocated)} has no matching balance and will be recorded without an expense.
          </ThemedText>
        )}

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
              {fmt(amountNum)} doesn&apos;t match the {fmt(selectedCandidates[0]?.remaining ?? 0)}{' '}
              remaining on this expense.
            </ThemedText>
            {canResplit ? (
              <Pressable
                onPress={onResplit}
                style={[styles.actionPrimary, { backgroundColor: theme.backgroundSelected }]}>
                <ThemedText type="smallBold">Resplit remaining evenly</ThemedText>
              </Pressable>
            ) : (
              <ThemedText type="small" themeColor="textSecondary" style={styles.warn}>
                More than the whole bill — resplitting is not possible. Adjust the split instead.
              </ThemedText>
            )}
            <Pressable
              onPress={onEditAmount}
              style={[styles.actionSecondary, { borderColor: theme.border }]}>
              <ThemedText type="smallBold">Confirm &amp; edit amount</ThemedText>
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
            Confirm &amp; Save
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
    borderWidth: StyleSheet.hairlineWidth,
  },
  checkbox: {
    width: 20,
    alignItems: 'center',
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
