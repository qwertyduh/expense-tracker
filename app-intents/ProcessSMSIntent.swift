import AppIntents
import Foundation
internal import ExpoAppIntents

/// Background half of the SMS capture pair, and the Shortcut's first action.
/// It never brings the app up (`openAppWhenRun = false`), but it does persist the
/// `processSms` invocation for an expense. The app may still be cold: the
/// invocation waits in the dispatcher's queue, JS parses it on mount, and
/// `OpenExpenseSMSIntent` (run only when this returns `true`) brings the app
/// forward so that parse can route to /add. Non-expenses return `false` and
/// dispatch nothing, so they can never open the app.
struct ProcessSMSIntent: AppIntent {
    static var title: LocalizedStringResource = "Process Incoming SMS"
    static var openAppWhenRun: Bool = false   // silent background classification

    @Parameter(title: "Message Text")
    var messageText: String

    func perform() async throws -> some IntentResult & ReturnsValue<Bool> {
        if isRejected(text: messageText) {
            // OTP / statement: never opens the app — the Shortcut's If sees false.
            return .result(value: false)
        }

        let isExpenseMessage = isExpense(text: messageText)

        // Only a real expense reaches the JS Add Expense path. Dispatch from here
        // (not from the foreground intent) so the raw text is wired once and the
        // invocation is queued even if the app is not running yet.
        if isExpenseMessage {
            await AppIntentDispatcher.shared.dispatch(
                name: "processSms",
                params: ["text": .string(messageText)]
            )
        }

        return .result(value: isExpenseMessage)
    }

    private func isExpense(text: String) -> Bool {
        // Mirror of DEBIT_AMOUNT_PATTERNS in src/parsers/sms.ts — default-deny.
        // Each alternative carries BOTH the debit verb and the amount, so a
        // stray figure (a balance) or an unanchored verb (a future EMI "will be
        // debited") can't pass. Keep this in sync when the parser changes.
        let patterns = [
            #"(?:Rs\.?|INR|₹)\s?[\d,]+(?:\.\d+)?\s*(?:has\s+been\s+|is\s+|was\s+)?(?:debited|deducted|withdrawn|charged)\b"#,
            #"\b(?:Sent|Spent|You\s+paid|Paid|Debited|Deducted|Withdrawn|Charged|Transferred)\b[^.\n]{0,40}?(?:Rs\.?|INR|₹)\s?[\d,]"#,
            #"(?m)^Pay\s+(?:Rs\.?|INR|₹)\s?[\d,]"#,
        ]
        return patterns.contains { text.range(of: $0, options: [.regularExpression, .caseInsensitive]) != nil }
    }

    private func isRejected(text: String) -> Bool {
        // Mirror of REJECT_PATTERNS in src/parsers/sms.ts. These are the only
        // messages that carry a debit verb and an amount yet are not one
        // transaction, so they are checked before the expense gate.
        let pattern = #"\botp\b|one[\s-]?time\s+password|verification\s+code|do\s+not\s+share|mini[\s-]?statement|account\s+statement|e[\s-]?statement"#
        return text.range(of: pattern, options: [.regularExpression, .caseInsensitive]) != nil
    }
}

/// Foreground half of the pair. It has no parameters and does no work: the
/// classifier has already dispatched the text. Its only job is to bring the app
/// up (`openAppWhenRun = true`), which the Shortcut does solely when the
/// classifier returned `true`. On launch, `useAppIntents` drains the queued
/// `processSms` invocation, `parseAnySms` parses it, and the Add flow opens
/// pre-filled.
struct OpenExpenseSMSIntent: AppIntent {
    static var title: LocalizedStringResource = "Open Expense from SMS"
    static var openAppWhenRun: Bool = true

    func perform() async throws -> some IntentResult {
        return .result()
    }
}
