import { useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Pressable, StyleSheet, View } from "react-native";

import { AmountSlide } from "@/components/add-flow/amount-slide";
import { CategorySlide } from "@/components/add-flow/category-slide";
import { LabelSlide } from "@/components/add-flow/label-slide";
import { PreviewSlide } from "@/components/add-flow/preview-slide";
import { SplitSlide, SplitSummary } from "@/components/add-flow/split-slide";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Spacing } from "@/constants/theme";
import { CategoryRow } from "@/db/categories";
import { insertExpense } from "@/db/expenses";
import { getMerchantMemory, rememberMerchant } from "@/db/merchant-memory";
import { AddExpenseIntent } from "@/hooks/useAddExpenseIntent";
import { useAddExpenseIntentContext } from "@/hooks/add-expense-intent-provider";
import { useKeyboardHeight } from "@/hooks/use-keyboard";
import { formatCurrency } from "@/lib/format";
import { liveActivity } from "@/lib/live-activity";
import { syncMerchantCategoryMap } from "@/lib/merchant-category-sync";
import { findSettlementMatches } from "@/lib/settlement-matching";
import { settleSharedDebt } from "@/lib/shared-debts";
import { enqueueSharedExpense, flushOutbox } from "@/lib/sync";

const STEP_NAMES = ["Amount", "Category", "Split", "Label", "Preview"] as const;
const LAST_STEP = STEP_NAMES.length - 1;

// Slide indices whose data can arrive pre-filled by the SMS parser.
const AMOUNT_STEP = 0;
const CATEGORY_STEP = 1;
const SPLIT_STEP = 2;

type InitialState = {
  amount: string;
  category: CategoryRow | null;
  /** First slide that still needs input. */
  step: number;
  /** Raw SMS the state was built from, so a warm-start intent can be detected. */
  appliedSms: string | null;
};

// The Add flow opens at the first slide whose data is not already known. An SMS
// carries its amount, so Amount is skipped; when the merchant has been filed
// before (merchant_memory), the category is known too and Category is skipped.
// Split and Label are never skipped — Split is always a real choice and Label
// has nothing to pre-fill. Synchronous DB reads, so this can run in a useState
// initializer with no first-frame flash of a slide we then jump off.
function buildInitial(intent: AddExpenseIntent | null): InitialState {
  if (intent?.source !== "sms") {
    return { amount: "", category: null, step: AMOUNT_STEP, appliedSms: null };
  }

  const amount = intent.prefill.amount != null ? String(intent.prefill.amount) : "";
  const memory = intent.prefill.merchant
    ? getMerchantMemory(intent.prefill.merchant)
    : null;
  const category = memory?.category ?? null;

  // Never skip Amount without one to fall back on: a deep link can carry a
  // merchant but no parseable amount, and an empty Amount slide must be asked.
  let step = AMOUNT_STEP;
  if (amount !== "") step = CATEGORY_STEP;
  if (amount !== "" && category != null) step = SPLIT_STEP;

  return { amount, category, step, appliedSms: intent.rawText };
}

export default function AddScreen() {
  const { intent, clear } = useAddExpenseIntentContext();
  const router = useRouter();
  // Bottom padding equal to the keyboard height while it's up, so the centered
  // slide content + footer reflow above the keyboard (layout shift, not a
  // transform — transforms on a focused field dismiss the keyboard on iOS).
  const keyboardHeight = useKeyboardHeight();
  // Built once from the intent that opened the screen: amount + (remembered)
  // category pre-filled, opening on the first slide that still needs input.
  const [initial] = useState(() => buildInitial(intent));
  const [currentStep, setCurrentStep] = useState(initial.step);
  const [amount, setAmount] = useState(initial.amount);
  const [category, setCategory] = useState<CategoryRow | null>(initial.category);
  const [split, setSplit] = useState<SplitSummary | null>(null);
  const [label, setLabel] = useState("");
  const totalAmount = parseFloat(amount) || 0;

  // Warm start: a fresh SMS can arrive while /add is already mounted, so re-apply
  // its prefill and jump to the first slide that still needs input. Keyed on the
  // raw text so re-renders for the same message never wipe in-progress edits.
  const appliedSms = useRef<string | null>(initial.appliedSms);
  useEffect(() => {
    if (intent?.source !== "sms") return;
    if (appliedSms.current === intent.rawText) return;
    appliedSms.current = intent.rawText;

    const next = buildInitial(intent);
    setAmount(next.amount);
    setCategory(next.category);
    setSplit(null);
    setLabel("");
    setCurrentStep(next.step);
  }, [intent]);

  // No intent = opened directly (e.g. the raw add:// route) -> behave exactly
  // like a manual open: empty amount, nothing pre-filled.
  const smsIntent = intent?.source === "sms" ? intent : null;
  const isManual = smsIntent == null;
  const outgoingMatches = useMemo(() => {
    const parsedAmount = smsIntent?.prefill.amount;
    if (!parsedAmount) return [];
    return findSettlementMatches({
      amount: parsedAmount,
      direction: "outgoing",
      counterpartyHint: smsIntent?.prefill.merchant ?? null,
    }).slice(0, 2);
  }, [smsIntent]);

  const settleDetectedOutgoing = (match: (typeof outgoingMatches)[number]) => {
    const parsedAmount = smsIntent?.prefill.amount ?? totalAmount;
    settleSharedDebt({
      participantId: match.row.participantId,
      expenseId: match.row.expenseId,
      amount: parsedAmount,
      method: "detected_outgoing",
    })
      .then((outcome) => {
        if (outcome.state === "failed") {
          Alert.alert(
            "Could not settle shared expense",
            outcome.error ?? "Try again."
          );
          return;
        }
        if (outcome.state === "pending") {
          Alert.alert(
            "Saved",
            "The payment will be recorded when you are back online."
          );
        }
        liveActivity.endAll().catch(() => {});
        if (smsIntent) liveActivity.removePendingCapture(smsIntent.rawText);
        clear();
        router.replace("/");
      })
      .catch((err) => {
        Alert.alert(
          "Could not settle shared expense",
          err instanceof Error ? err.message : "Try again."
        );
      });
  };
  const isAmountStep = currentStep === AMOUNT_STEP;

  const goNext = () => {
    setCurrentStep((step) => Math.min(step + 1, LAST_STEP));
  };

  const goBack = () => {
    setCurrentStep((step) => Math.max(step - 1, 0));
  };

  const canConfirm =
    totalAmount > 0 && category != null && split != null;

  // Shared DB write for both confirm paths; returns the new id so the edit
  // path can navigate to it.
  const saveExpense = (): string | null => {
    if (!canConfirm || !category || !split) return null;
    const trimmedLabel = label.trim() || null;
    const { expenseId, sharedExpense } = insertExpense({
      totalAmount,
      selfShare: split.selfShare,
      categoryId: category.id,
      label: trimmedLabel,
      merchant: smsIntent ? smsIntent.prefill.merchant : null,
      source: smsIntent ? "sms" : "manual",
      bankSource: smsIntent ? smsIntent.bankSource : null,
      rawSmsText: smsIntent ? smsIntent.rawText : null,
      // The SMS carries its own date; fall back to the save time when it had
      // none (manual entry, or a message with an unusable date).
      occurredAt: smsIntent?.prefill.occurredAt ?? new Date().toISOString(),
      participants: split.participants,
    });
    if (sharedExpense) {
      enqueueSharedExpense(sharedExpense);
      flushOutbox().catch(() => {});
    }
    // Learn the payee -> category mapping so the next SMS from it opens past the
    // Category slide. Only SMS entries carry a merchant, and only confirmed
    // writes should teach anything.
    if (smsIntent?.prefill.merchant) {
      rememberMerchant(smsIntent.prefill.merchant, category.id, split.participantCount);
      // Refresh the native vendor -> category map the Live Activity reads.
      syncMerchantCategoryMap();
    }
    // Confirming (or confirm-and-edit) is the end of the capture: dismiss the capsule
    // and clear the pending entry so the foreground flush can't log it again.
    liveActivity.endAll().catch(() => {});
    if (smsIntent) {
      liveActivity.removePendingCapture(smsIntent.rawText);
    }
    return expenseId;
  };

  const confirmAndSave = () => {
    saveExpense();
  };

  const confirmAndEditAmount = () => {
    const expenseId = saveExpense();
    if (!expenseId) return;
    clear();
    router.replace(`/expense/${expenseId}?edit=1`);
  };

  const exitToHome = () => {
    clear();
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/");
    }
  };

  return (
    <ThemedView style={[styles.container, { paddingBottom: keyboardHeight }]}>
      {/* Persistent ✕ top corner on every slide — blueprint §3 discard. Nothing
          is written until Preview's confirm, so no confirmation dialog. */}
      <View style={styles.header}>
        <ThemedText type="smallBold">
          {currentStep + 1}/{STEP_NAMES.length} {STEP_NAMES[currentStep]}
        </ThemedText>
        <Pressable
          onPress={exitToHome}
          hitSlop={12}
          accessibilityLabel="Close add expense"
        >
          <ThemedText type="subtitle">✕</ThemedText>
        </Pressable>
      </View>

      {outgoingMatches.length > 0 ? (
        <View style={styles.sharedMatch}>
          <ThemedText type="smallBold">Possible shared payment</ThemedText>
          {outgoingMatches.map((match) => (
            <View key={match.row.participantId} style={styles.sharedRow}>
              <ThemedText type="small" style={styles.sharedText}>
                @{match.row.counterpartyUsername} ·{" "}
                {match.row.label ?? "Shared expense"} ·{" "}
                {formatCurrency(match.remaining)}
                {match.exact ? " · exact match" : " · within ₹1"}
              </ThemedText>
              <Pressable onPress={() => settleDetectedOutgoing(match)}>
                <ThemedText type="linkPrimary">Settle</ThemedText>
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}

      {isAmountStep ? (
        <AmountSlide value={amount} onChangeAmount={setAmount} autoFocus={isManual} />
      ) : currentStep === 1 ? (
        <CategorySlide selectedId={category?.id ?? null} onSelect={setCategory} />
      ) : currentStep === 2 ? (
        <SplitSlide totalAmount={totalAmount} onChange={setSplit} />
      ) : currentStep === 3 ? (
        <LabelSlide value={label} onChangeLabel={setLabel} />
      ) : (
        <PreviewSlide
          totalAmount={totalAmount}
          categoryName={category?.name ?? null}
          label={label}
          merchant={smsIntent ? smsIntent.prefill.merchant : null}
          rawSmsText={smsIntent ? smsIntent.rawText : null}
          split={split}
          canConfirm={canConfirm}
          onConfirm={confirmAndSave}
          onConfirmAndEdit={confirmAndEditAmount}
          onDone={exitToHome}
        />
      )}

      <View style={styles.footer}>
        {currentStep > 0 && (
          <Pressable onPress={goBack}>
            <ThemedText type="link">Back</ThemedText>
          </Pressable>
        )}
        {currentStep < LAST_STEP && (
          <Pressable onPress={goNext} style={styles.next}>
            <ThemedText type="linkPrimary">Next</ThemedText>
          </Pressable>
        )}
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: Spacing.six,
    paddingHorizontal: Spacing.four,
  },
  sharedMatch: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#3C87F7',
    backgroundColor: 'rgba(60,135,247,0.12)',
    borderRadius: 12,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  sharedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
  },
  sharedText: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  footer: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: Spacing.four,
  },
  next: {
    marginLeft: "auto",
  },
});
