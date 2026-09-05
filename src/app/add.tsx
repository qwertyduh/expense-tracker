import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

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
import { useAddExpenseIntentContext } from "@/hooks/add-expense-intent-provider";

const STEP_NAMES = ["Amount", "Category", "Split", "Label", "Preview"] as const;
const LAST_STEP = STEP_NAMES.length - 1;

export default function AddScreen() {
  const { intent, clear } = useAddExpenseIntentContext();
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState(0);
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState<CategoryRow | null>(null);
  const [split, setSplit] = useState<SplitSummary | null>(null);
  const [label, setLabel] = useState("");
  const totalAmount = parseFloat(amount) || 0;

  const smsPrefillAmount =
    intent?.source === "sms" && intent.prefill.amount != null
      ? String(intent.prefill.amount)
      : null;

  // Pre-fill from SMS parse; ignore manual opens (amount typed by hand anyway).
  useEffect(() => {
    if (smsPrefillAmount != null) setAmount(smsPrefillAmount);
  }, [smsPrefillAmount]);

  // No intent = opened directly (e.g. the raw add:// route) -> behave exactly
  // like a manual open: empty amount, nothing pre-filled.
  const smsIntent = intent?.source === "sms" ? intent : null;
  const isManual = smsIntent == null;
  const isAmountStep = currentStep === 0;

  const goNext = () => {
    setCurrentStep((step) => Math.min(step + 1, LAST_STEP));
  };

  const goBack = () => {
    setCurrentStep((step) => Math.max(step - 1, 0));
  };

  const participants = split?.participants ?? [];
  const canConfirm =
    totalAmount > 0 && category != null && participants.length > 0;

  const confirmAndSave = () => {
    if (!canConfirm || !category) return;
    const trimmedLabel = label.trim() || null;
    insertExpense({
      totalAmount,
      categoryId: category.id,
      label: trimmedLabel,
      merchant: smsIntent ? smsIntent.prefill.merchant : null,
      source: smsIntent ? "sms" : "manual",
      bankSource: smsIntent ? smsIntent.bankSource : null,
      rawSmsText: smsIntent ? smsIntent.rawText : null,
      occurredAt: new Date().toISOString(),
      participants,
    });
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
    <ThemedView style={styles.container}>
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

      <View style={styles.step}>
        {isAmountStep ? (
          <AmountSlide
            value={amount}
            onChangeAmount={setAmount}
            autoFocus={isManual}
          />
        ) : currentStep === 1 ? (
          <CategorySlide
            selectedId={category?.id ?? null}
            onSelect={setCategory}
          />
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
            participants={participants}
            canConfirm={canConfirm}
            onConfirm={confirmAndSave}
            onDone={exitToHome}
          />
        )}
      </View>

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
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  step: {
    flex: 1,
    justifyContent: "center",
    paddingVertical: Spacing.two,
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
